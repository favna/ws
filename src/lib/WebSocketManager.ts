import { EventEmitter } from 'events';
import { mergeDefault, sleep } from '@klasa/utils';
import { REST, Routes } from '@klasa/rest';
import { Cache } from '@klasa/cache';
import { AsyncQueue } from '@klasa/async-queue';

import type { APIGatewayBotData } from '@klasa/dapi-types';

import { WebSocketShard, WebSocketShardStatus } from './WebSocketShard';
import { WSOptionsDefaults } from '../util/Constants';
import * as Types from '../types/InternalWebSocket';

import type { IntentsResolvable } from '../util/Intents';

export interface WSOptions {
	shards: 'auto' | number | number[];
	totalShards: number | null;
	intents: IntentsResolvable;
	additionalOptions: Record<string, unknown>;
	gatewayVersion: number;
}

/**
 * The singleton to manage multiple Websocket Connections to the discord api
 */
export class WebSocketManager extends EventEmitter {

	/**
	 * The shards of this WebsocketManager
	 */
	public readonly shards: Cache<number, WebSocketShard> = new Cache();

	/**
	 * The options for this WebsocketManager
	 */
	public readonly options: Required<WSOptions>;

	/**
	 * The token to use for the api
	 */
	#token: string | null;

	/**
	 * The shard queue that handles spawning or reconnecting shards
	 * @private
	 */
	#queue: AsyncQueue;

	/**
	 * Data related to the gateway (like session limit)
	 * @private
	 */
	#gatewayInfo!: APIGatewayBotData;

	/**
	 * @param api The rest api
	 * @param shardIDs The shards to spawn
	 */
	public constructor(private api: REST, options: Partial<WSOptions>) {
		super();
		this.options = mergeDefault(WSOptionsDefaults, options);
		// eslint-disable-next-line no-process-env
		this.#token = process.env.DISCORD_TOKEN || null;
		this.#queue = new AsyncQueue();
	}

	/**
	 * The token to use for websocket connections
	 */
	public set token(token: string) {
		this.#token = token;
	}

	/**
	 * Spawns new Shards to handle individual WebSocketConnections
	 */
	public async spawn(): Promise<void> {
		// We need a bot token to connect to the websocket
		if (!this.#token) throw new Error('A token is required for connecting to the gateway.');

		// Get gateway info from the api and cache it
		this.#gatewayInfo = await this.api.get(Routes.gatewayBot()) as APIGatewayBotData;

		// Make a list of shards to spawn
		const shards = [];

		if (Array.isArray(this.options.shards)) {
			// Starting a list of specified shards
			if (!this.options.totalShards) throw new Error('totalShards must be supplied if you are defining shards with an array.');
			shards.push(...this.options.shards.filter(item => typeof item === 'number' && !Number.isNaN(item)));
		} else if (this.options.shards === 'auto') {
			// Starting a list of automatically recommended shards
			this.options.totalShards = this.#gatewayInfo.shards;
			for (let i = 0; i < this.#gatewayInfo.shards; i++) shards.push(i);
		} else {
			// Starting a specified number of shards
			this.options.totalShards = this.options.shards;
			for (let i = 0; i < this.options.shards; i++) shards.push(i);
		}

		// Debug what the api says we can spawn
		this.debug([
			`Session Limit [`,
			`  Total      : ${this.#gatewayInfo.session_start_limit.total}`,
			`  Remaining  : ${this.#gatewayInfo.session_start_limit.remaining}`,
			`  Reset After: ${this.#gatewayInfo.session_start_limit.reset_after}ms`,
			`]`
		].join('\n'));

		// Debug what shards we are starting
		this.debug(`Shard Queue: ${shards.join(', ')}`);

		// Wait for all the shards to connect
		await Promise.all(shards.map(id => this.queueShard(id)));
	}

	/**
	 * A shard has disconnected and needs to identify again
	 * @param shard The Shard to identify again
	 */
	public scheduleIdentify(shard: WebSocketShard): void {
		this.queueShard(shard.id);
	}

	/**
	 * Destroys all the shards
	 */
	public destroy(): void {
		for (const shard of this.shards.values()) shard.destroy();
	}

	/**
	 * A shard cannot be resumed and must be connected from scratch
	 * @param shard The shard to reconnect from scratch
	 */
	public scheduleShardRestart(shard: WebSocketShard): void {
		this.shards.delete(shard.id);
		this.queueShard(shard.id);
	}

	/**
	 * Queues a shard to be connect
	 * @param id The shard id
	 */
	private async queueShard(id: number): Promise<void> {
		await this.#queue.wait();
		try {
			// Get or create a new WebSocketShard
			const shard = this.getShard(id);

			// Don't try to connect if the shard is already connected
			if (shard.status === WebSocketShardStatus.Connected) return;

			// Check if we can identify
			await this.handleSessionLimit();

			// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
			const status = await shard.connect(this.#token!);

			// If we get an invalid session, to the back of the line you go
			if (status === Types.GatewayStatus.InvalidSession) {
				this.debug(`Invalid Session[${id}] Requeued for identify later`);
				this.queueShard(id);
			}

			// Alert how many shards are remaining in the queue and wait for 5 seconds before the next one
			if (this.#queue.remaining > 1) {
				this.debug(`Queue Size: ${this.#queue.remaining - 1} — waiting 5s`);
				await sleep(5000);
			}
		} finally {
			this.#queue.shift();
		}
	}

	/**
	 * Gets or Creates a shard by id
	 * @param id The id to get/create a shard
	 */
	private getShard(id: number): WebSocketShard {
		const shard = this.shards.get(id) || new WebSocketShard(this, id, this.options.totalShards, this.#gatewayInfo.url);
		this.shards.set(id, shard);
		return shard;
	}

	/**
	 * Checks if we can try to connect another shard, waits if needed
	 */
	private async handleSessionLimit(): Promise<void> {
		this.#gatewayInfo = await this.api.get(Routes.gatewayBot()) as APIGatewayBotData;

		const { session_start_limit: { reset_after: resetAfter, remaining } } = this.#gatewayInfo;

		if (remaining === 0) {
			this.debug(`Session Identify Limit reached — Waiting ${resetAfter}ms`);
			await sleep(resetAfter);
		}
	}

	/**
	 * Emits a ws debug message
	 * @param message The message to emit
	 */
	private debug(message: string): void {
		this.emit(Types.WebSocketManagerEvents.Debug, `[Manager(${this.options.totalShards})] ${message}`);
	}

	// #region Overloads

	/* eslint-disable no-dupe-class-members */
	public on(event: Types.WebSocketEvents.Ready, listener: (data: Types.ReadyDispatch) => void): this
	public on(event: Types.WebSocketEvents.Resumed, listener: (data: Types.ResumedDispatch) => void): this
	public on(event: Types.WebSocketEvents.ChannelCreate | Types.WebSocketEvents.ChannelDelete | Types.WebSocketEvents.ChannelUpdate, listener: (data: Types.ChannelCreateDispatch) => void): this
	public on(event: Types.WebSocketEvents.ChannelPinsUpdate, listener: (data: Types.ChannelPinsUpdateDispatch) => void): this
	public on(event: Types.WebSocketEvents.GuildCreate | Types.WebSocketEvents.GuildUpdate, listener: (data: Types.GuildCreateDispatch) => void): this
	public on(event: Types.WebSocketEvents.GuildDelete, listener: (data: Types.GuildDeleteDispatch) => void): this
	public on(event: Types.WebSocketEvents.GuildBanAdd | Types.WebSocketEvents.GuildBanRemove, listener: (data: Types.GuildBanAddDispatch) => void): this
	public on(event: Types.WebSocketEvents.GuildEmojisUpdate, listener: (data: Types.GuildEmojisUpdateDispatch) => void): this
	public on(event: Types.WebSocketEvents.GuildIntegrationsUpdate, listener: (data: Types.GuildIntegrationsUpdateDispatch) => void): this
	public on(event: Types.WebSocketEvents.GuildMemberAdd, listener: (data: Types.GuildMemberAddDispatch) => void): this
	public on(event: Types.WebSocketEvents.GuildMemberRemove, listener: (data: Types.GuildMemberRemoveDispatch) => void): this
	public on(event: Types.WebSocketEvents.GuildMemberUpdate, listener: (data: Types.GuildMemberUpdateDispatch) => void): this
	public on(event: Types.WebSocketEvents.GuildMembersChunk, listener: (data: Types.GuildMembersChunkDispatch) => void): this
	public on(event: Types.WebSocketEvents.GuildRoleCreate | Types.WebSocketEvents.GuildRoleUpdate, listener: (data: Types.GuildRoleCreateDispatch) => void): this
	public on(event: Types.WebSocketEvents.GuildRoleDelete, listener: (data: Types.GuildRoleDeleteDispatch) => void): this
	public on(event: Types.WebSocketEvents.MessageCreate, listener: (data: Types.MessageCreateDispatch) => void): this
	public on(event: Types.WebSocketEvents.MessageUpdate, listener: (data: Types.MessageUpdateDispatch) => void): this
	public on(event: Types.WebSocketEvents.MessageDelete, listener: (data: Types.MessageDeleteDispatch) => void): this
	public on(event: Types.WebSocketEvents.MessageDeleteBulk, listener: (data: Types.MessageDeleteBulkDispatch) => void): this
	public on(event: Types.WebSocketEvents.MessageReactionAdd, listener: (data: Types.MessageReactionAddDispatch) => void): this
	public on(event: Types.WebSocketEvents.MessageReactionRemove, listener: (data: Types.MessageReactionRemoveDispatch) => void): this
	public on(event: Types.WebSocketEvents.MessageReactionRemoveAll, listener: (data: Types.MessageReactionRemoveAllDispatch) => void): this
	public on(event: Types.WebSocketEvents.PresenceUpdate, listener: (data: Types.PresenceUpdateDispatch) => void): this
	public on(event: Types.WebSocketEvents.TypingStart, listener: (data: Types.TypingStartDispatch) => void): this
	public on(event: Types.WebSocketEvents.UserUpdate, listener: (data: Types.UserUpdateDispatch) => void): this
	public on(event: Types.WebSocketEvents.VoiceStateUpdate, listener: (data: Types.VoiceStateUpdateDispatch) => void): this
	public on(event: Types.WebSocketEvents.VoiceServerUpdate, listener: (data: Types.VoiceServerUpdateDispatch) => void): this
	public on(event: Types.WebSocketEvents.WebhooksUpdate, listener: (data: Types.WebhooksUpdateDispatch) => void): this
	public on(event: Types.WebSocketManagerEvents.Debug, listener: (data: string) => void): this
	public on(event: Types.WebSocketManagerEvents.Error, listener: (data: Error) => void): this
	public on(event: Types.WebSocketEvents | Types.WebSocketManagerEvents, listener: (data: Types.DispatchPayload | string | Error) => void): this
	public on(event: string | symbol, listener: (...args: any[]) => void): this {
		return super.on(event, listener);
	}

	public once(event: Types.WebSocketEvents.Ready, listener: (data: Types.ReadyDispatch) => void): this
	public once(event: Types.WebSocketEvents.Resumed, listener: (data: Types.ResumedDispatch) => void): this
	public once(event: Types.WebSocketEvents.ChannelCreate | Types.WebSocketEvents.ChannelDelete | Types.WebSocketEvents.ChannelUpdate, listener: (data: Types.ChannelCreateDispatch) => void): this
	public once(event: Types.WebSocketEvents.ChannelPinsUpdate, listener: (data: Types.ChannelPinsUpdateDispatch) => void): this
	public once(event: Types.WebSocketEvents.GuildCreate | Types.WebSocketEvents.GuildUpdate, listener: (data: Types.GuildCreateDispatch) => void): this
	public once(event: Types.WebSocketEvents.GuildDelete, listener: (data: Types.GuildDeleteDispatch) => void): this
	public once(event: Types.WebSocketEvents.GuildBanAdd | Types.WebSocketEvents.GuildBanRemove, listener: (data: Types.GuildBanAddDispatch) => void): this
	public once(event: Types.WebSocketEvents.GuildEmojisUpdate, listener: (data: Types.GuildEmojisUpdateDispatch) => void): this
	public once(event: Types.WebSocketEvents.GuildIntegrationsUpdate, listener: (data: Types.GuildIntegrationsUpdateDispatch) => void): this
	public once(event: Types.WebSocketEvents.GuildMemberAdd, listener: (data: Types.GuildMemberAddDispatch) => void): this
	public once(event: Types.WebSocketEvents.GuildMemberRemove, listener: (data: Types.GuildMemberRemoveDispatch) => void): this
	public once(event: Types.WebSocketEvents.GuildMemberUpdate, listener: (data: Types.GuildMemberUpdateDispatch) => void): this
	public once(event: Types.WebSocketEvents.GuildMembersChunk, listener: (data: Types.GuildMembersChunkDispatch) => void): this
	public once(event: Types.WebSocketEvents.GuildRoleCreate | Types.WebSocketEvents.GuildRoleUpdate, listener: (data: Types.GuildRoleCreateDispatch) => void): this
	public once(event: Types.WebSocketEvents.GuildRoleDelete, listener: (data: Types.GuildRoleDeleteDispatch) => void): this
	public once(event: Types.WebSocketEvents.MessageCreate, listener: (data: Types.MessageCreateDispatch) => void): this
	public once(event: Types.WebSocketEvents.MessageUpdate, listener: (data: Types.MessageUpdateDispatch) => void): this
	public once(event: Types.WebSocketEvents.MessageDelete, listener: (data: Types.MessageDeleteDispatch) => void): this
	public once(event: Types.WebSocketEvents.MessageDeleteBulk, listener: (data: Types.MessageDeleteBulkDispatch) => void): this
	public once(event: Types.WebSocketEvents.MessageReactionAdd, listener: (data: Types.MessageReactionAddDispatch) => void): this
	public once(event: Types.WebSocketEvents.MessageReactionRemove, listener: (data: Types.MessageReactionRemoveDispatch) => void): this
	public once(event: Types.WebSocketEvents.MessageReactionRemoveAll, listener: (data: Types.MessageReactionRemoveAllDispatch) => void): this
	public once(event: Types.WebSocketEvents.PresenceUpdate, listener: (data: Types.PresenceUpdateDispatch) => void): this
	public once(event: Types.WebSocketEvents.TypingStart, listener: (data: Types.TypingStartDispatch) => void): this
	public once(event: Types.WebSocketEvents.UserUpdate, listener: (data: Types.UserUpdateDispatch) => void): this
	public once(event: Types.WebSocketEvents.VoiceStateUpdate, listener: (data: Types.VoiceStateUpdateDispatch) => void): this
	public once(event: Types.WebSocketEvents.VoiceServerUpdate, listener: (data: Types.VoiceServerUpdateDispatch) => void): this
	public once(event: Types.WebSocketEvents.WebhooksUpdate, listener: (data: Types.WebhooksUpdateDispatch) => void): this
	public once(event: Types.WebSocketManagerEvents.Debug, listener: (data: string) => void): this
	public once(event: Types.WebSocketManagerEvents.Error, listener: (data: Error) => void): this
	public once(event: Types.WebSocketEvents | Types.WebSocketManagerEvents, listener: (data: Types.DispatchPayload | string | Error) => void): this
	public once(event: string | symbol, listener: (...args: any[]) => void): this {
		return super.once(event, listener);
	}

	public addListener(event: Types.WebSocketEvents.Ready, listener: (data: Types.ReadyDispatch) => void): this
	public addListener(event: Types.WebSocketEvents.Resumed, listener: (data: Types.ResumedDispatch) => void): this
	public addListener(event: Types.WebSocketEvents.ChannelCreate | Types.WebSocketEvents.ChannelDelete
	| Types.WebSocketEvents.ChannelUpdate, listener: (data: Types.ChannelCreateDispatch) => void): this
	public addListener(event: Types.WebSocketEvents.ChannelPinsUpdate, listener: (data: Types.ChannelPinsUpdateDispatch) => void): this
	public addListener(event: Types.WebSocketEvents.GuildCreate | Types.WebSocketEvents.GuildUpdate, listener: (data: Types.GuildCreateDispatch) => void): this
	public addListener(event: Types.WebSocketEvents.GuildDelete, listener: (data: Types.GuildDeleteDispatch) => void): this
	public addListener(event: Types.WebSocketEvents.GuildBanAdd | Types.WebSocketEvents.GuildBanRemove, listener: (data: Types.GuildBanAddDispatch) => void): this
	public addListener(event: Types.WebSocketEvents.GuildEmojisUpdate, listener: (data: Types.GuildEmojisUpdateDispatch) => void): this
	public addListener(event: Types.WebSocketEvents.GuildIntegrationsUpdate, listener: (data: Types.GuildIntegrationsUpdateDispatch) => void): this
	public addListener(event: Types.WebSocketEvents.GuildMemberAdd, listener: (data: Types.GuildMemberAddDispatch) => void): this
	public addListener(event: Types.WebSocketEvents.GuildMemberRemove, listener: (data: Types.GuildMemberRemoveDispatch) => void): this
	public addListener(event: Types.WebSocketEvents.GuildMemberUpdate, listener: (data: Types.GuildMemberUpdateDispatch) => void): this
	public addListener(event: Types.WebSocketEvents.GuildMembersChunk, listener: (data: Types.GuildMembersChunkDispatch) => void): this
	public addListener(event: Types.WebSocketEvents.GuildRoleCreate | Types.WebSocketEvents.GuildRoleUpdate, listener: (data: Types.GuildRoleCreateDispatch) => void): this
	public addListener(event: Types.WebSocketEvents.GuildRoleDelete, listener: (data: Types.GuildRoleDeleteDispatch) => void): this
	public addListener(event: Types.WebSocketEvents.MessageCreate, listener: (data: Types.MessageCreateDispatch) => void): this
	public addListener(event: Types.WebSocketEvents.MessageUpdate, listener: (data: Types.MessageUpdateDispatch) => void): this
	public addListener(event: Types.WebSocketEvents.MessageDelete, listener: (data: Types.MessageDeleteDispatch) => void): this
	public addListener(event: Types.WebSocketEvents.MessageDeleteBulk, listener: (data: Types.MessageDeleteBulkDispatch) => void): this
	public addListener(event: Types.WebSocketEvents.MessageReactionAdd, listener: (data: Types.MessageReactionAddDispatch) => void): this
	public addListener(event: Types.WebSocketEvents.MessageReactionRemove, listener: (data: Types.MessageReactionRemoveDispatch) => void): this
	public addListener(event: Types.WebSocketEvents.MessageReactionRemoveAll, listener: (data: Types.MessageReactionRemoveAllDispatch) => void): this
	public addListener(event: Types.WebSocketEvents.PresenceUpdate, listener: (data: Types.PresenceUpdateDispatch) => void): this
	public addListener(event: Types.WebSocketEvents.TypingStart, listener: (data: Types.TypingStartDispatch) => void): this
	public addListener(event: Types.WebSocketEvents.UserUpdate, listener: (data: Types.UserUpdateDispatch) => void): this
	public addListener(event: Types.WebSocketEvents.VoiceStateUpdate, listener: (data: Types.VoiceStateUpdateDispatch) => void): this
	public addListener(event: Types.WebSocketEvents.VoiceServerUpdate, listener: (data: Types.VoiceServerUpdateDispatch) => void): this
	public addListener(event: Types.WebSocketEvents.WebhooksUpdate, listener: (data: Types.WebhooksUpdateDispatch) => void): this
	public addListener(event: Types.WebSocketManagerEvents.Debug, listener: (data: string) => void): this
	public addListener(event: Types.WebSocketManagerEvents.Error, listener: (data: Error) => void): this
	public addListener(event: Types.WebSocketEvents | Types.WebSocketManagerEvents, listener: (data: Types.DispatchPayload | string | Error) => void): this
	public addListener(event: string | symbol, listener: (...args: any[]) => void): this {
		return super.addListener(event, listener);
	}

	public removeListener(event: Types.WebSocketEvents.Ready, listener: (data: Types.ReadyDispatch) => void): this
	public removeListener(event: Types.WebSocketEvents.Resumed, listener: (data: Types.ResumedDispatch) => void): this
	public removeListener(event: Types.WebSocketEvents.ChannelCreate | Types.WebSocketEvents.ChannelDelete
	| Types.WebSocketEvents.ChannelUpdate, listener: (data: Types.ChannelCreateDispatch) => void): this
	public removeListener(event: Types.WebSocketEvents.ChannelPinsUpdate, listener: (data: Types.ChannelPinsUpdateDispatch) => void): this
	public removeListener(event: Types.WebSocketEvents.GuildCreate | Types.WebSocketEvents.GuildUpdate, listener: (data: Types.GuildCreateDispatch) => void): this
	public removeListener(event: Types.WebSocketEvents.GuildDelete, listener: (data: Types.GuildDeleteDispatch) => void): this
	public removeListener(event: Types.WebSocketEvents.GuildBanAdd | Types.WebSocketEvents.GuildBanRemove, listener: (data: Types.GuildBanAddDispatch) => void): this
	public removeListener(event: Types.WebSocketEvents.GuildEmojisUpdate, listener: (data: Types.GuildEmojisUpdateDispatch) => void): this
	public removeListener(event: Types.WebSocketEvents.GuildIntegrationsUpdate, listener: (data: Types.GuildIntegrationsUpdateDispatch) => void): this
	public removeListener(event: Types.WebSocketEvents.GuildMemberAdd, listener: (data: Types.GuildMemberAddDispatch) => void): this
	public removeListener(event: Types.WebSocketEvents.GuildMemberRemove, listener: (data: Types.GuildMemberRemoveDispatch) => void): this
	public removeListener(event: Types.WebSocketEvents.GuildMemberUpdate, listener: (data: Types.GuildMemberUpdateDispatch) => void): this
	public removeListener(event: Types.WebSocketEvents.GuildMembersChunk, listener: (data: Types.GuildMembersChunkDispatch) => void): this
	public removeListener(event: Types.WebSocketEvents.GuildRoleCreate | Types.WebSocketEvents.GuildRoleUpdate, listener: (data: Types.GuildRoleCreateDispatch) => void): this
	public removeListener(event: Types.WebSocketEvents.GuildRoleDelete, listener: (data: Types.GuildRoleDeleteDispatch) => void): this
	public removeListener(event: Types.WebSocketEvents.MessageCreate, listener: (data: Types.MessageCreateDispatch) => void): this
	public removeListener(event: Types.WebSocketEvents.MessageUpdate, listener: (data: Types.MessageUpdateDispatch) => void): this
	public removeListener(event: Types.WebSocketEvents.MessageDelete, listener: (data: Types.MessageDeleteDispatch) => void): this
	public removeListener(event: Types.WebSocketEvents.MessageDeleteBulk, listener: (data: Types.MessageDeleteBulkDispatch) => void): this
	public removeListener(event: Types.WebSocketEvents.MessageReactionAdd, listener: (data: Types.MessageReactionAddDispatch) => void): this
	public removeListener(event: Types.WebSocketEvents.MessageReactionRemove, listener: (data: Types.MessageReactionRemoveDispatch) => void): this
	public removeListener(event: Types.WebSocketEvents.MessageReactionRemoveAll, listener: (data: Types.MessageReactionRemoveAllDispatch) => void): this
	public removeListener(event: Types.WebSocketEvents.PresenceUpdate, listener: (data: Types.PresenceUpdateDispatch) => void): this
	public removeListener(event: Types.WebSocketEvents.TypingStart, listener: (data: Types.TypingStartDispatch) => void): this
	public removeListener(event: Types.WebSocketEvents.UserUpdate, listener: (data: Types.UserUpdateDispatch) => void): this
	public removeListener(event: Types.WebSocketEvents.VoiceStateUpdate, listener: (data: Types.VoiceStateUpdateDispatch) => void): this
	public removeListener(event: Types.WebSocketEvents.VoiceServerUpdate, listener: (data: Types.VoiceServerUpdateDispatch) => void): this
	public removeListener(event: Types.WebSocketEvents.WebhooksUpdate, listener: (data: Types.WebhooksUpdateDispatch) => void): this
	public removeListener(event: Types.WebSocketManagerEvents.Debug, listener: (data: string) => void): this
	public removeListener(event: Types.WebSocketManagerEvents.Error, listener: (data: Error) => void): this
	public removeListener(event: Types.WebSocketEvents | Types.WebSocketManagerEvents, listener: (data: Types.DispatchPayload | string | Error) => void): this
	public removeListener(event: string | symbol, listener: (...args: any[]) => void): this {
		return super.removeListener(event, listener);
	}
	/* eslint-enable no-dupe-class-members */
	// #endregion

}

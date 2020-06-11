import { EventEmitter } from 'events';
import { mergeDefault, sleep } from '@klasa/utils';
import { REST, Routes } from '@klasa/rest';
import { Cache } from '@klasa/cache';
import { AsyncQueue } from '@klasa/async-queue';

import type { APIGatewayBotData } from '@klasa/dapi-types';

import {
	GatewayStatus,
	WebSocketManagerEvents,
	ReadyDispatch,
	WebSocketEvents,
	ResumedDispatch,
	ChannelCreateDispatch,
	GuildCreateDispatch,
	ChannelPinsUpdateDispatch,
	GuildDeleteDispatch,
	GuildBanAddDispatch,
	GuildEmojisUpdateDispatch,
	GuildIntegrationsUpdateDispatch,
	GuildMemberAddDispatch,
	GuildMemberRemoveDispatch,
	GuildMemberUpdateDispatch,
	GuildMembersChunkDispatch,
	GuildRoleCreateDispatch,
	GuildRoleDeleteDispatch,
	InviteCreateDispatch,
	InviteDeleteDispatch,
	MessageCreateDispatch,
	MessageDeleteBulkDispatch,
	MessageDeleteDispatch,
	MessageReactionAddDispatch,
	MessageUpdateDispatch,
	MessageReactionRemoveAllDispatch,
	MessageReactionRemoveDispatch,
	PresenceUpdateDispatch,
	TypingStartDispatch,
	UserUpdateDispatch,
	VoiceStateUpdateDispatch,
	VoiceServerUpdateDispatch,
	WebhooksUpdateDispatch,
	DispatchPayload
} from '../types/InternalWebSocket';
import { WebSocketShard, WebSocketShardStatus } from './WebSocketShard';
import { WSOptionsDefaults } from '../util/Constants';

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
	 * Returns the average ping of all the shards.
	 */
	public get ping(): number {
		const sum = this.shards.reduce((a, b) => a + b.ping, 0);
		return sum / this.shards.size;
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
			if (status === GatewayStatus.InvalidSession) {
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
		this.emit(WebSocketManagerEvents.Debug, `[Manager(${this.options.totalShards})] ${message}`);
	}

	// #region Overloads

	/* eslint-disable no-dupe-class-members */
	public on(event: WebSocketEvents.Ready, listener: (data: ReadyDispatch) => void): this
	public on(event: WebSocketEvents.Resumed, listener: (data: ResumedDispatch) => void): this
	public on(event: WebSocketEvents.ChannelCreate | WebSocketEvents.ChannelDelete | WebSocketEvents.ChannelUpdate, listener: (data: ChannelCreateDispatch) => void): this
	public on(event: WebSocketEvents.ChannelPinsUpdate, listener: (data: ChannelPinsUpdateDispatch) => void): this
	public on(event: WebSocketEvents.GuildCreate | WebSocketEvents.GuildUpdate, listener: (data: GuildCreateDispatch) => void): this
	public on(event: WebSocketEvents.GuildDelete, listener: (data: GuildDeleteDispatch) => void): this
	public on(event: WebSocketEvents.GuildBanAdd | WebSocketEvents.GuildBanRemove, listener: (data: GuildBanAddDispatch) => void): this
	public on(event: WebSocketEvents.GuildEmojisUpdate, listener: (data: GuildEmojisUpdateDispatch) => void): this
	public on(event: WebSocketEvents.GuildIntegrationsUpdate, listener: (data: GuildIntegrationsUpdateDispatch) => void): this
	public on(event: WebSocketEvents.GuildMemberAdd, listener: (data: GuildMemberAddDispatch) => void): this
	public on(event: WebSocketEvents.GuildMemberRemove, listener: (data: GuildMemberRemoveDispatch) => void): this
	public on(event: WebSocketEvents.GuildMemberUpdate, listener: (data: GuildMemberUpdateDispatch) => void): this
	public on(event: WebSocketEvents.GuildMembersChunk, listener: (data: GuildMembersChunkDispatch) => void): this
	public on(event: WebSocketEvents.GuildRoleCreate | WebSocketEvents.GuildRoleUpdate, listener: (data: GuildRoleCreateDispatch) => void): this
	public on(event: WebSocketEvents.GuildRoleDelete, listener: (data: GuildRoleDeleteDispatch) => void): this
	public on(event: WebSocketEvents.InviteCreate, listener: (data: InviteCreateDispatch) => void): this
	public on(event: WebSocketEvents.InviteDelete, listener: (data: InviteDeleteDispatch) => void): this
	public on(event: WebSocketEvents.MessageCreate, listener: (data: MessageCreateDispatch) => void): this
	public on(event: WebSocketEvents.MessageUpdate, listener: (data: MessageUpdateDispatch) => void): this
	public on(event: WebSocketEvents.MessageDelete, listener: (data: MessageDeleteDispatch) => void): this
	public on(event: WebSocketEvents.MessageDeleteBulk, listener: (data: MessageDeleteBulkDispatch) => void): this
	public on(event: WebSocketEvents.MessageReactionAdd, listener: (data: MessageReactionAddDispatch) => void): this
	public on(event: WebSocketEvents.MessageReactionRemove, listener: (data: MessageReactionRemoveDispatch) => void): this
	public on(event: WebSocketEvents.MessageReactionRemoveAll, listener: (data: MessageReactionRemoveAllDispatch) => void): this
	public on(event: WebSocketEvents.PresenceUpdate, listener: (data: PresenceUpdateDispatch) => void): this
	public on(event: WebSocketEvents.TypingStart, listener: (data: TypingStartDispatch) => void): this
	public on(event: WebSocketEvents.UserUpdate, listener: (data: UserUpdateDispatch) => void): this
	public on(event: WebSocketEvents.VoiceStateUpdate, listener: (data: VoiceStateUpdateDispatch) => void): this
	public on(event: WebSocketEvents.VoiceServerUpdate, listener: (data: VoiceServerUpdateDispatch) => void): this
	public on(event: WebSocketEvents.WebhooksUpdate, listener: (data: WebhooksUpdateDispatch) => void): this
	public on(event: WebSocketManagerEvents.Debug, listener: (data: string) => void): this
	public on(event: WebSocketManagerEvents.Error, listener: (data: Error) => void): this
	public on(event: WebSocketEvents | WebSocketManagerEvents, listener: (data: DispatchPayload | string | Error) => void): this
	public on(event: string | symbol, listener: (...args: any[]) => void): this {
		return super.on(event, listener);
	}

	public once(event: WebSocketEvents.Ready, listener: (data: ReadyDispatch) => void): this
	public once(event: WebSocketEvents.Resumed, listener: (data: ResumedDispatch) => void): this
	public once(event: WebSocketEvents.ChannelCreate | WebSocketEvents.ChannelDelete | WebSocketEvents.ChannelUpdate, listener: (data: ChannelCreateDispatch) => void): this
	public once(event: WebSocketEvents.ChannelPinsUpdate, listener: (data: ChannelPinsUpdateDispatch) => void): this
	public once(event: WebSocketEvents.GuildCreate | WebSocketEvents.GuildUpdate, listener: (data: GuildCreateDispatch) => void): this
	public once(event: WebSocketEvents.GuildDelete, listener: (data: GuildDeleteDispatch) => void): this
	public once(event: WebSocketEvents.GuildBanAdd | WebSocketEvents.GuildBanRemove, listener: (data: GuildBanAddDispatch) => void): this
	public once(event: WebSocketEvents.GuildEmojisUpdate, listener: (data: GuildEmojisUpdateDispatch) => void): this
	public once(event: WebSocketEvents.GuildIntegrationsUpdate, listener: (data: GuildIntegrationsUpdateDispatch) => void): this
	public once(event: WebSocketEvents.GuildMemberAdd, listener: (data: GuildMemberAddDispatch) => void): this
	public once(event: WebSocketEvents.GuildMemberRemove, listener: (data: GuildMemberRemoveDispatch) => void): this
	public once(event: WebSocketEvents.GuildMemberUpdate, listener: (data: GuildMemberUpdateDispatch) => void): this
	public once(event: WebSocketEvents.GuildMembersChunk, listener: (data: GuildMembersChunkDispatch) => void): this
	public once(event: WebSocketEvents.GuildRoleCreate | WebSocketEvents.GuildRoleUpdate, listener: (data: GuildRoleCreateDispatch) => void): this
	public once(event: WebSocketEvents.GuildRoleDelete, listener: (data: GuildRoleDeleteDispatch) => void): this
	public once(event: WebSocketEvents.InviteCreate, listener: (data: InviteCreateDispatch) => void): this
	public once(event: WebSocketEvents.InviteDelete, listener: (data: InviteDeleteDispatch) => void): this
	public once(event: WebSocketEvents.MessageCreate, listener: (data: MessageCreateDispatch) => void): this
	public once(event: WebSocketEvents.MessageUpdate, listener: (data: MessageUpdateDispatch) => void): this
	public once(event: WebSocketEvents.MessageDelete, listener: (data: MessageDeleteDispatch) => void): this
	public once(event: WebSocketEvents.MessageDeleteBulk, listener: (data: MessageDeleteBulkDispatch) => void): this
	public once(event: WebSocketEvents.MessageReactionAdd, listener: (data: MessageReactionAddDispatch) => void): this
	public once(event: WebSocketEvents.MessageReactionRemove, listener: (data: MessageReactionRemoveDispatch) => void): this
	public once(event: WebSocketEvents.MessageReactionRemoveAll, listener: (data: MessageReactionRemoveAllDispatch) => void): this
	public once(event: WebSocketEvents.PresenceUpdate, listener: (data: PresenceUpdateDispatch) => void): this
	public once(event: WebSocketEvents.TypingStart, listener: (data: TypingStartDispatch) => void): this
	public once(event: WebSocketEvents.UserUpdate, listener: (data: UserUpdateDispatch) => void): this
	public once(event: WebSocketEvents.VoiceStateUpdate, listener: (data: VoiceStateUpdateDispatch) => void): this
	public once(event: WebSocketEvents.VoiceServerUpdate, listener: (data: VoiceServerUpdateDispatch) => void): this
	public once(event: WebSocketEvents.WebhooksUpdate, listener: (data: WebhooksUpdateDispatch) => void): this
	public once(event: WebSocketManagerEvents.Debug, listener: (data: string) => void): this
	public once(event: WebSocketManagerEvents.Error, listener: (data: Error) => void): this
	public once(event: WebSocketEvents | WebSocketManagerEvents, listener: (data: DispatchPayload | string | Error) => void): this
	public once(event: string | symbol, listener: (...args: any[]) => void): this {
		return super.once(event, listener);
	}

	public addListener(event: WebSocketEvents.Ready, listener: (data: ReadyDispatch) => void): this
	public addListener(event: WebSocketEvents.Resumed, listener: (data: ResumedDispatch) => void): this
	public addListener(event: WebSocketEvents.ChannelCreate | WebSocketEvents.ChannelDelete
	| WebSocketEvents.ChannelUpdate, listener: (data: ChannelCreateDispatch) => void): this
	public addListener(event: WebSocketEvents.ChannelPinsUpdate, listener: (data: ChannelPinsUpdateDispatch) => void): this
	public addListener(event: WebSocketEvents.GuildCreate | WebSocketEvents.GuildUpdate, listener: (data: GuildCreateDispatch) => void): this
	public addListener(event: WebSocketEvents.GuildDelete, listener: (data: GuildDeleteDispatch) => void): this
	public addListener(event: WebSocketEvents.GuildBanAdd | WebSocketEvents.GuildBanRemove, listener: (data: GuildBanAddDispatch) => void): this
	public addListener(event: WebSocketEvents.GuildEmojisUpdate, listener: (data: GuildEmojisUpdateDispatch) => void): this
	public addListener(event: WebSocketEvents.GuildIntegrationsUpdate, listener: (data: GuildIntegrationsUpdateDispatch) => void): this
	public addListener(event: WebSocketEvents.GuildMemberAdd, listener: (data: GuildMemberAddDispatch) => void): this
	public addListener(event: WebSocketEvents.GuildMemberRemove, listener: (data: GuildMemberRemoveDispatch) => void): this
	public addListener(event: WebSocketEvents.GuildMemberUpdate, listener: (data: GuildMemberUpdateDispatch) => void): this
	public addListener(event: WebSocketEvents.GuildMembersChunk, listener: (data: GuildMembersChunkDispatch) => void): this
	public addListener(event: WebSocketEvents.GuildRoleCreate | WebSocketEvents.GuildRoleUpdate, listener: (data: GuildRoleCreateDispatch) => void): this
	public addListener(event: WebSocketEvents.GuildRoleDelete, listener: (data: GuildRoleDeleteDispatch) => void): this
	public addListener(event: WebSocketEvents.InviteCreate, listener: (data: InviteCreateDispatch) => void): this
	public addListener(event: WebSocketEvents.InviteDelete, listener: (data: InviteDeleteDispatch) => void): this
	public addListener(event: WebSocketEvents.MessageCreate, listener: (data: MessageCreateDispatch) => void): this
	public addListener(event: WebSocketEvents.MessageUpdate, listener: (data: MessageUpdateDispatch) => void): this
	public addListener(event: WebSocketEvents.MessageDelete, listener: (data: MessageDeleteDispatch) => void): this
	public addListener(event: WebSocketEvents.MessageDeleteBulk, listener: (data: MessageDeleteBulkDispatch) => void): this
	public addListener(event: WebSocketEvents.MessageReactionAdd, listener: (data: MessageReactionAddDispatch) => void): this
	public addListener(event: WebSocketEvents.MessageReactionRemove, listener: (data: MessageReactionRemoveDispatch) => void): this
	public addListener(event: WebSocketEvents.MessageReactionRemoveAll, listener: (data: MessageReactionRemoveAllDispatch) => void): this
	public addListener(event: WebSocketEvents.PresenceUpdate, listener: (data: PresenceUpdateDispatch) => void): this
	public addListener(event: WebSocketEvents.TypingStart, listener: (data: TypingStartDispatch) => void): this
	public addListener(event: WebSocketEvents.UserUpdate, listener: (data: UserUpdateDispatch) => void): this
	public addListener(event: WebSocketEvents.VoiceStateUpdate, listener: (data: VoiceStateUpdateDispatch) => void): this
	public addListener(event: WebSocketEvents.VoiceServerUpdate, listener: (data: VoiceServerUpdateDispatch) => void): this
	public addListener(event: WebSocketEvents.WebhooksUpdate, listener: (data: WebhooksUpdateDispatch) => void): this
	public addListener(event: WebSocketManagerEvents.Debug, listener: (data: string) => void): this
	public addListener(event: WebSocketManagerEvents.Error, listener: (data: Error) => void): this
	public addListener(event: WebSocketEvents | WebSocketManagerEvents, listener: (data: DispatchPayload | string | Error) => void): this
	public addListener(event: string | symbol, listener: (...args: any[]) => void): this {
		return super.addListener(event, listener);
	}

	public removeListener(event: WebSocketEvents.Ready, listener: (data: ReadyDispatch) => void): this
	public removeListener(event: WebSocketEvents.Resumed, listener: (data: ResumedDispatch) => void): this
	public removeListener(event: WebSocketEvents.ChannelCreate | WebSocketEvents.ChannelDelete
	| WebSocketEvents.ChannelUpdate, listener: (data: ChannelCreateDispatch) => void): this
	public removeListener(event: WebSocketEvents.ChannelPinsUpdate, listener: (data: ChannelPinsUpdateDispatch) => void): this
	public removeListener(event: WebSocketEvents.GuildCreate | WebSocketEvents.GuildUpdate, listener: (data: GuildCreateDispatch) => void): this
	public removeListener(event: WebSocketEvents.GuildDelete, listener: (data: GuildDeleteDispatch) => void): this
	public removeListener(event: WebSocketEvents.GuildBanAdd | WebSocketEvents.GuildBanRemove, listener: (data: GuildBanAddDispatch) => void): this
	public removeListener(event: WebSocketEvents.GuildEmojisUpdate, listener: (data: GuildEmojisUpdateDispatch) => void): this
	public removeListener(event: WebSocketEvents.GuildIntegrationsUpdate, listener: (data: GuildIntegrationsUpdateDispatch) => void): this
	public removeListener(event: WebSocketEvents.GuildMemberAdd, listener: (data: GuildMemberAddDispatch) => void): this
	public removeListener(event: WebSocketEvents.GuildMemberRemove, listener: (data: GuildMemberRemoveDispatch) => void): this
	public removeListener(event: WebSocketEvents.GuildMemberUpdate, listener: (data: GuildMemberUpdateDispatch) => void): this
	public removeListener(event: WebSocketEvents.GuildMembersChunk, listener: (data: GuildMembersChunkDispatch) => void): this
	public removeListener(event: WebSocketEvents.GuildRoleCreate | WebSocketEvents.GuildRoleUpdate, listener: (data: GuildRoleCreateDispatch) => void): this
	public removeListener(event: WebSocketEvents.GuildRoleDelete, listener: (data: GuildRoleDeleteDispatch) => void): this
	public removeListener(event: WebSocketEvents.InviteCreate, listener: (data: InviteCreateDispatch) => void): this
	public removeListener(event: WebSocketEvents.InviteDelete, listener: (data: InviteDeleteDispatch) => void): this
	public removeListener(event: WebSocketEvents.MessageCreate, listener: (data: MessageCreateDispatch) => void): this
	public removeListener(event: WebSocketEvents.MessageUpdate, listener: (data: MessageUpdateDispatch) => void): this
	public removeListener(event: WebSocketEvents.MessageDelete, listener: (data: MessageDeleteDispatch) => void): this
	public removeListener(event: WebSocketEvents.MessageDeleteBulk, listener: (data: MessageDeleteBulkDispatch) => void): this
	public removeListener(event: WebSocketEvents.MessageReactionAdd, listener: (data: MessageReactionAddDispatch) => void): this
	public removeListener(event: WebSocketEvents.MessageReactionRemove, listener: (data: MessageReactionRemoveDispatch) => void): this
	public removeListener(event: WebSocketEvents.MessageReactionRemoveAll, listener: (data: MessageReactionRemoveAllDispatch) => void): this
	public removeListener(event: WebSocketEvents.PresenceUpdate, listener: (data: PresenceUpdateDispatch) => void): this
	public removeListener(event: WebSocketEvents.TypingStart, listener: (data: TypingStartDispatch) => void): this
	public removeListener(event: WebSocketEvents.UserUpdate, listener: (data: UserUpdateDispatch) => void): this
	public removeListener(event: WebSocketEvents.VoiceStateUpdate, listener: (data: VoiceStateUpdateDispatch) => void): this
	public removeListener(event: WebSocketEvents.VoiceServerUpdate, listener: (data: VoiceServerUpdateDispatch) => void): this
	public removeListener(event: WebSocketEvents.WebhooksUpdate, listener: (data: WebhooksUpdateDispatch) => void): this
	public removeListener(event: WebSocketManagerEvents.Debug, listener: (data: string) => void): this
	public removeListener(event: WebSocketManagerEvents.Error, listener: (data: Error) => void): this
	public removeListener(event: WebSocketEvents | WebSocketManagerEvents, listener: (data: DispatchPayload | string | Error) => void): this
	public removeListener(event: string | symbol, listener: (...args: any[]) => void): this {
		return super.removeListener(event, listener);
	}
	/* eslint-enable no-dupe-class-members */
	// #endregion

}

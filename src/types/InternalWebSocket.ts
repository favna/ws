import type {
	APIChannelData,
	APIEmojiData,
	APIEmojiPartial,
	APIGuildData,
	APIGuildMemberData,
	APIGuildUnavailable,
	APIMessageData,
	APIPresenceUpdateData,
	APIRoleData,
	APIUserData,
	APIVoiceStateData,
	APIActivityData,
	InviteTargetUserType
} from '@klasa/dapi-types';
import type { WSOptions } from '../lib/WebSocketManager';
import type { WebSocketShardStatus } from '../lib/WebSocketShard';

export const enum WebSocketManagerEvents {
	Debug = 'debug',
	Error = 'error',
	ShardOnline = 'shardOnline',
	ClientWSDebug = 'wsDebug',
}

export const enum InternalActions {
	Debug = 'DEBUG',
	Dispatch = 'DISPATCH',
	Destroy = 'DESTROY',
	Identify = 'IDENTIFY',
	UpdatePing = 'UPDATE_PING',
	ScheduleIdentify = 'SCHEDULE_IDENTIFY',
	GatewayStatus = 'GATEWAY_STATUS',
	CannotReconnect = 'CANNOT_RECONNECT',
	ConnectionStatusUpdate = 'CONNECTION_STATUS_UPDATE',
	PayloadDispatch = 'PAYLOAD_DISPATCH',
	Reconnect = 'RECONNECT',
	FetchSessionData = 'FETCH_SESSION_DATA',
}

export const enum WSCloseCodes {
	UnknownError = 4000,
	UnknownOpCode,
	DecodeError,
	NotAuthenticated,
	AuthenticationFailed,
	AlreadyAuthenticated,
	InvalidSeq = 4007,
	RateLimited,
	SessionTimeout,
	InvalidShard,
	ShardingRequired,
	InvalidVersion,
	InvalidIntents,
	DisallowedIntents,
	ReconnectRequested = 4900,
}

export const enum OpCodes {
	DISPATCH = 0,
	HEARTBEAT = 1,
	IDENTIFY = 2,
	STATUS_UPDATE = 3,
	VOICE_STATE_UPDATE = 4,
	RESUME = 6,
	RECONNECT = 7,
	REQUEST_GUILD_MEMBERS = 8,
	INVALID_SESSION = 9,
	HELLO = 10,
	HEARTBEAT_ACK = 11,
}

export const enum WebSocketEvents {
	Ready = 'READY',
	Resumed = 'RESUMED',
	ChannelCreate = 'CHANNEL_CREATE',
	ChannelUpdate = 'CHANNEL_UPDATE',
	ChannelDelete = 'CHANNEL_DELETE',
	ChannelPinsUpdate = 'CHANNEL_PINS_UPDATE',
	GuildCreate = 'GUILD_CREATE',
	GuildUpdate = 'GUILD_UPDATE',
	GuildDelete = 'GUILD_DELETE',
	GuildBanAdd = 'GUILD_BAN_ADD',
	GuildBanRemove = 'GUILD_BAN_REMOVE',
	GuildEmojisUpdate = 'GUILD_EMOJIS_UPDATE',
	GuildIntegrationsUpdate = 'GUILD_INTEGRATIONS_UPDATE',
	GuildMemberAdd = 'GUILD_MEMBER_ADD',
	GuildMemberRemove = 'GUILD_MEMBER_REMOVE',
	GuildMemberUpdate = 'GUILD_MEMBER_UPDATE',
	GuildMembersChunk = 'GUILD_MEMBERS_CHUNK',
	GuildRoleCreate = 'GUILD_ROLE_CREATE',
	GuildRoleUpdate = 'GUILD_ROLE_UPDATE',
	GuildRoleDelete = 'GUILD_ROLE_DELETE',
	InviteCreate = 'INVITE_CREATE',
	InviteDelete = 'INVITE_DELETE',
	MessageCreate = 'MESSAGE_CREATE',
	MessageUpdate = 'MESSAGE_UPDATE',
	MessageDelete = 'MESSAGE_DELETE',
	MessageDeleteBulk = 'MESSAGE_DELETE_BULK',
	MessageReactionAdd = 'MESSAGE_REACTION_ADD',
	MessageReactionRemove = 'MESSAGE_REACTION_REMOVE',
	MessageReactionRemoveAll = 'MESSAGE_REACTION_REMOVE_ALL',
	MessageReactionRemoveEmoji = 'MESSAGE_REACTION_REMOVE_EMOJI',
	PresenceUpdate = 'PRESENCE_UPDATE',
	TypingStart = 'TYPING_START',
	UserUpdate = 'USER_UPDATE',
	VoiceStateUpdate = 'VOICE_STATE_UPDATE',
	VoiceServerUpdate = 'VOICE_SERVER_UPDATE',
	WebhooksUpdate = 'WEBHOOKS_UPDATE',
}

export type WSPayload = HelloPayload | Heartbeat | HeartbeatAck | InvalidSession | Reconnect | DispatchPayload;
export type SendPayload = WSHeartbeat | Identify | PresenceUpdate | VoiceStateUpdate | Resume | RequestGuildMembers;

// #region Basic payloads
export interface HelloPayload extends BasePayload {
	op: OpCodes.HELLO;
	t: never;
	d: {
		heartbeat_interval: number
	};
}

export interface Heartbeat extends BasePayload {
	op: OpCodes.HEARTBEAT;
	t: never;
	d: never;
}

export interface HeartbeatAck extends BasePayload {
	op: OpCodes.HEARTBEAT_ACK;
	t: never;
	d: never;
}

export interface InvalidSession extends BasePayload {
	op: OpCodes.INVALID_SESSION;
	t: never;
	d: boolean;
}

export interface Reconnect extends BasePayload {
	op: OpCodes.RECONNECT;
	t: never;
	d: never;
}
// #endregion Basic payloads

// #region Dispatch

/**
 * https://discord.com/developers/docs/topics/gateway#ready
 */
export type ReadyDispatch = DataPayload<WebSocketEvents.Ready, {
	v: number,
	user_settings: {},
	user: APIUserData,
	session_id: string,
	relationships: [],
	private_channels: [],
	presences: [],
	guilds: APIGuildUnavailable[],
	shard?: [number, number]
}>;

/**
 * https://discord.com/developers/docs/topics/gateway#resumed
 */
export type ResumedDispatch = DataPayload<WebSocketEvents.Resumed, never>;

/* eslint-disable @typescript-eslint/indent */

/**
 * https://discord.com/developers/docs/topics/gateway#channel-create
 * https://discord.com/developers/docs/topics/gateway#channel-update
 * https://discord.com/developers/docs/topics/gateway#channel-delete
 */
export type ChannelCreateDispatch = DataPayload<
	WebSocketEvents.ChannelCreate
	| WebSocketEvents.ChannelDelete
	| WebSocketEvents.ChannelUpdate,
	APIChannelData
>;

/* eslint-enable @typescript-eslint/indent */

/**
 * https://discord.com/developers/docs/topics/gateway#channel-pins-update
 */
export type ChannelPinsUpdateDispatch = DataPayload<WebSocketEvents.ChannelPinsUpdate, {
	guild_id?: string,
	channel_id: string,
	last_pin_timestamp?: string
}>;

/**
 * https://discord.com/developers/docs/topics/gateway#guild-create
 * https://discord.com/developers/docs/topics/gateway#guild-update
 */
export type GuildCreateDispatch = DataPayload<WebSocketEvents.GuildCreate | WebSocketEvents.GuildUpdate, APIGuildData>;

/**
 * https://discord.com/developers/docs/topics/gateway#guild-delete
 */
export type GuildDeleteDispatch = DataPayload<WebSocketEvents.GuildDelete, APIGuildUnavailable>;

/**
 * https://discord.com/developers/docs/topics/gateway#guild-ban-add
 * https://discord.com/developers/docs/topics/gateway#guild-ban-remove
 */
export type GuildBanAddDispatch = DataPayload<WebSocketEvents.GuildBanAdd | WebSocketEvents.GuildBanRemove, {
	guild_id: string,
	user: APIUserData
}>;

/**
 * https://discord.com/developers/docs/topics/gateway#guild-emojis-update
 */
export type GuildEmojisUpdateDispatch = DataPayload<WebSocketEvents.GuildEmojisUpdate, {
	guild_id: string,
	emojis: APIEmojiData[]
}>;

/**
 * https://discord.com/developers/docs/topics/gateway#guild-integrations-update
 */
export type GuildIntegrationsUpdateDispatch = DataPayload<WebSocketEvents.GuildIntegrationsUpdate, { guild_id: string }>;

/**
 * https://discord.com/developers/docs/topics/gateway#guild-member-add
 */
export type GuildMemberAddDispatch = DataPayload<WebSocketEvents.GuildMemberAdd, APIGuildMemberData & { guild_id: string }>;

/**
 * https://discord.com/developers/docs/topics/gateway#guild-member-remove
 */
export type GuildMemberRemoveDispatch = DataPayload<WebSocketEvents.GuildMemberRemove, {
	guild_id: string,
	user: APIUserData
}>;

/**
 * https://discord.com/developers/docs/topics/gateway#guild-member-update
 */
export type GuildMemberUpdateDispatch = DataPayload<WebSocketEvents.GuildMemberUpdate, {
	guild_id: string,
	roles: string[],
	user: APIUserData,
	nick?: string | null,
	premium_since?: string | null
}>;

/**
 * https://discord.com/developers/docs/topics/gateway#guild-members-chunk
 */
export type GuildMembersChunkDispatch = DataPayload<WebSocketEvents.GuildMembersChunk, {
	guild_id: string,
	members: APIGuildMemberData[],
	chunk_index?: number,
	chunk_count?: number,
	not_found?: unknown[],
	presences?: APIPresenceUpdateData[],
	nonce?: string
}>;

/**
 * https://discord.com/developers/docs/topics/gateway#guild-role-create
 * https://discord.com/developers/docs/topics/gateway#guild-role-update
 */
export type GuildRoleCreateDispatch = DataPayload<WebSocketEvents.GuildRoleCreate | WebSocketEvents.GuildRoleUpdate, {
	guild_id: string,
	role: APIRoleData
}>;

/**
 * https://discord.com/developers/docs/topics/gateway#guild-role-delete
 */
export type GuildRoleDeleteDispatch = DataPayload<WebSocketEvents.GuildRoleDelete, {
	guild_id: string,
	role_id: string
}>;

/**
 * https://discord.com/developers/docs/topics/gateway#invite-create
 */
export type InviteCreateDispatch = DataPayload<WebSocketEvents.InviteCreate, {
	channel_id: string,
	code: string,
	created_at: number,
	guild_id?: string,
	inviter?: APIUserData,
	max_age: number,
	max_uses: number,
	target_user?: APIUserData,
	target_user_type?: InviteTargetUserType,
	temporary: boolean,
	uses: 0
}>;

/**
 * https://discord.com/developers/docs/topics/gateway#invite-delete
 */
export type InviteDeleteDispatch = DataPayload<WebSocketEvents.InviteDelete, {
	channel_id: string,
	guild_id?: string,
	code: string
}>;

/**
 * https://discord.com/developers/docs/topics/gateway#message-create
 */
export type MessageCreateDispatch = DataPayload<WebSocketEvents.MessageCreate, APIMessageData>;

/**
 * https://discord.com/developers/docs/topics/gateway#message-update
 */
export type MessageUpdateDispatch = DataPayload<WebSocketEvents.MessageUpdate, { id: string, channel_id: string } & Partial<APIMessageData>>;

/**
 * https://discord.com/developers/docs/topics/gateway#message-delete
 */
export type MessageDeleteDispatch = DataPayload<WebSocketEvents.MessageDelete, {
	id: string,
	channel_id: string,
	guild_id?: string
}>;

/**
 * https://discord.com/developers/docs/topics/gateway#message-delete-bulk
 */
export type MessageDeleteBulkDispatch = DataPayload<WebSocketEvents.MessageDeleteBulk, {
	ids: string[],
	channel_id: string,
	guild_id?: string
}>;

/**
 * https://discord.com/developers/docs/topics/gateway#message-reaction-add
 */
export type MessageReactionAddDispatch = ReactionData<WebSocketEvents.MessageReactionAdd>;

/**
 * https://discord.com/developers/docs/topics/gateway#message-reaction-remove
 */
export type MessageReactionRemoveDispatch = ReactionData<WebSocketEvents.MessageReactionRemove, 'member'>;

/**
 * https://discord.com/developers/docs/topics/gateway#message-reaction-remove-all
 */
export type MessageReactionRemoveAllDispatch = DataPayload<WebSocketEvents.MessageReactionRemoveAll, MessageReactionRemoveData>;

/**
 * https://discord.com/developers/docs/topics/gateway#message-reaction-remove-emoji
 */
export type MessageReactionRemoveEmojiDispatch = DataPayload<WebSocketEvents.MessageReactionRemoveEmoji, MessageReactionRemoveData & {
	emoji: APIEmojiPartial
}>

/**
 * https://discord.com/developers/docs/topics/gateway#presence-update
 */
export type PresenceUpdateDispatch = DataPayload<WebSocketEvents.PresenceUpdate, APIPresenceUpdateData>;

/**
 * https://discord.com/developers/docs/topics/gateway#typing-start
 */
export type TypingStartDispatch = DataPayload<WebSocketEvents.TypingStart, {
	channel_id: string,
	guild_id?: string,
	user_id: string,
	timestamp: number,
	member?: APIGuildMemberData
}>;

/**
 * https://discord.com/developers/docs/topics/gateway#user-update
 */
export type UserUpdateDispatch = DataPayload<WebSocketEvents.UserUpdate, APIUserData>;

/**
 * https://discord.com/developers/docs/topics/gateway#voice-state-update
 */
export type VoiceStateUpdateDispatch = DataPayload<WebSocketEvents.VoiceStateUpdate, APIVoiceStateData>;

/**
 * https://discord.com/developers/docs/topics/gateway#voice-server-update
 */
export type VoiceServerUpdateDispatch = DataPayload<WebSocketEvents.VoiceServerUpdate, {
	token: string,
	guild_id: string,
	endpoint: string
}>;

/**
 * https://discord.com/developers/docs/topics/gateway#webhooks-update
 */
export type WebhooksUpdateDispatch = DataPayload<WebSocketEvents.WebhooksUpdate, {
	guild_id: string,
	channel_id: string
}>;

export type DispatchPayload =
	ReadyDispatch
	| ResumedDispatch
	| ChannelCreateDispatch
	| ChannelPinsUpdateDispatch
	| GuildCreateDispatch
	| GuildDeleteDispatch
	| GuildBanAddDispatch
	| GuildEmojisUpdateDispatch
	| GuildIntegrationsUpdateDispatch
	| GuildMemberAddDispatch
	| GuildMemberRemoveDispatch
	| GuildMemberUpdateDispatch
	| GuildMembersChunkDispatch
	| GuildRoleCreateDispatch
	| GuildRoleDeleteDispatch
	| InviteCreateDispatch
	| InviteDeleteDispatch
	| MessageCreateDispatch
	| MessageUpdateDispatch
	| MessageDeleteDispatch
	| MessageDeleteBulkDispatch
	| MessageReactionAddDispatch
	| MessageReactionRemoveDispatch
	| MessageReactionRemoveAllDispatch
	| MessageReactionRemoveEmojiDispatch
	| PresenceUpdateDispatch
	| TypingStartDispatch
	| UserUpdateDispatch
	| VoiceStateUpdateDispatch
	| VoiceServerUpdateDispatch
	| WebhooksUpdateDispatch;

// #endregion Dispatch

// #region Sendables
export interface WSHeartbeat {
	op: OpCodes.HEARTBEAT;
	d: number;
}

export interface Identify {
	op: OpCodes.IDENTIFY;
	d: {
		token: string,
		properties: {
			$os: string,
			$browser: string,
			device: string
		},
		large_threshold?: number,
		shard?: [number, number],
		presence?: PresenceUpdateData,
		intents?: number
	};
}

export interface Resume {
	op: OpCodes.RESUME;
	d: {
		token: string,
		session_id: string,
		seq: number
	};
}

export interface RequestGuildMembers {
	op: OpCodes.REQUEST_GUILD_MEMBERS;
	d: {
		guild_id: string | string[],
		query?: string,
		limit: number,
		presences?: boolean,
		user_ids?: string | string[]
	};
}

export interface VoiceStateUpdate {
	op: OpCodes.VOICE_STATE_UPDATE;
	d: {
		guild_id: string,
		channel_id: string | null,
		self_mute: boolean,
		self_deaf: boolean
	};
}

export interface PresenceUpdate {
	op: OpCodes.STATUS_UPDATE;
	d: PresenceUpdateData;
}
// #endregion Sendables

// #region Misc
interface BasePayload {
	op: OpCodes;
	s: number;
	d?: unknown;
	t?: string;
}

interface DataPayload<Event extends WebSocketEvents, D = unknown> extends BasePayload {
	op: OpCodes.DISPATCH;
	t: Event;
	d: D;
	// Internal to Project Blue
	shard_id: number;
}

type ReactionData<E extends WebSocketEvents, O extends string = never> = DataPayload<E, Omit<{
	user_id: string,
	channel_id: string,
	message_id: string,
	guild_id?: string,
	member?: APIGuildMemberData,
	emoji: APIEmojiPartial
}, O>>

interface MessageReactionRemoveData {
	channel_id: string;
	message_id: string;
	guild_id?: string;
}

export interface PresenceUpdateData {
	since: number | null;
	game: APIActivityData | null;
	status: 'online' | 'dnd' | 'idle' | 'invisible' | 'offline';
	afk: boolean;
}

export interface WSIdentify {
	properties: {
		$os: string,
		$browser: string,
		device: string
	};
	large_threshold?: number;
	shard?: [number, number];
	presence?: PresenceUpdateData;
	intents?: number;
}

export interface SessionDetails {
	session_id: string;
	seq: number;
}

// #endregion Misc

// #region InternalWS
export type WorkerMasterMessages = {
	type: InternalActions.Debug,
	data: string
} | {
	type: InternalActions.Dispatch,
	data: DispatchPayload
} | {
	type: InternalActions.Identify | InternalActions.ScheduleIdentify
} | {
	type: InternalActions.UpdatePing,
	data: number
} | {
	type: InternalActions.GatewayStatus,
	data: GatewayStatus
} | {
	type: InternalActions.CannotReconnect,
	data: {
		code: number,
		reason: string
	}
} | {
	type: InternalActions.ConnectionStatusUpdate,
	data: WebSocketShardStatus
} | {
	type: InternalActions.PayloadDispatch,
	data: SendPayload
} | {
	type: InternalActions.FetchSessionData,
	data: SessionDetails
};

export type MasterWorkerMessages = {
	type: InternalActions.Identify | InternalActions.Destroy | InternalActions.Reconnect | InternalActions.FetchSessionData
} | {
	type: InternalActions.PayloadDispatch,
	data: SendPayload
};

export interface WSWorkerData {
	gatewayURL: string;
	gatewayVersion: number;
	token: string;
	options: Required<WSOptions> & { shard: [number, number] };
}

export const enum GatewayStatus {
	Ready,
	InvalidSession,
}
// #endregion

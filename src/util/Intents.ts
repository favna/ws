import { BitField, BitFieldObject } from '@klasa/bitfield';

export const enum IntentsFlags {
	Guilds = 'GUILDS',
	GuildMembers = 'GUILD_MEMBERS',
	GuildBans = 'GUILD_BANS',
	GuildEmojis = 'GUILD_EMOJIS',
	GuildIntegrations = 'GUILD_INTEGRATIONS',
	GuildWebhooks = 'GUILD_WEBHOOKS',
	GuildInvites = 'GUILD_INVITES',
	GuildVoiceStates = 'GUILD_VOICE_STATES',
	GuildPresences = 'GUILD_PRESENCES',
	GuildMessages ='GUILD_MESSAGES',
	GuildMessageReactions = 'GUILD_MESSAGE_REACTIONS',
	GuildMessageTyping = 'GUILD_MESSAGE_TYPING',
	DirectMessages = 'DIRECT_MESSAGES',
	DirectMessageReactions = 'DIRECT_MESSAGE_REACTIONS',
	DirectMessageTyping = 'DIRECT_MESSAGE_TYPING'
}

export type IntentsResolvable = IntentsFlags | number | BitFieldObject | (IntentsFlags | number | BitFieldObject)[];

/* eslint-disable no-bitwise */

/**
 * Handles Gateway Intents in Project-Blue
 */
export class Intents extends BitField<IntentsResolvable> {

	/**
	 * The Intents flags
	 */
	public static FLAGS = {
		/**
		 * - GUILD_CREATE
		 * - GUILD_DELETE
		 * - GUILD_ROLE_CREATE
		 * - GUILD_ROLE_UPDATE
		 * - GUILD_ROLE_DELETE
		 * - CHANNEL_CREATE
		 * - CHANNEL_UPDATE
		 * - CHANNEL_DELETE
		 * - CHANNEL_PINS_UPDATE
		 */
		[IntentsFlags.Guilds]: 1 << 0,
		/**
		 * - GUILD_MEMBER_ADD
		 * - GUILD_MEMBER_UPDATE
		 * - GUILD_MEMBER_REMOVE
		 */
		[IntentsFlags.GuildMembers]: 1 << 1,
		/**
		 * - GUILD_BAN_ADD
		 * - GUILD_BAN_REMOVE
		 */
		[IntentsFlags.GuildBans]: 1 << 2,
		/**
		 * - GUILD_EMOJIS_UPDATE
		 */
		[IntentsFlags.GuildEmojis]: 1 << 3,
		/**
		 * - GUILD_INTEGRATIONS_UPDATE
		 */
		[IntentsFlags.GuildIntegrations]: 1 << 4,
		/**
		 * - WEBHOOKS_UPDATE
		 */
		[IntentsFlags.GuildWebhooks]: 1 << 5,
		/**
		 * - INVITE_CREATE
		 * - INVITE_DELETE
		 */
		[IntentsFlags.GuildInvites]: 1 << 6,
		/**
		 * - VOICE_STATE_UPDATE
		 */
		[IntentsFlags.GuildVoiceStates]: 1 << 7,
		/**
		 * - PRESENCE_UPDATE
		 */
		[IntentsFlags.GuildPresences]: 1 << 8,
		/**
		 * - MESSAGE_CREATE
		 * - MESSAGE_UPDATE
		 * - MESSAGE_DELETE
		 */
		[IntentsFlags.GuildMessages]: 1 << 9,
		/**
		 * - MESSAGE_REACTION_ADD
		 * - MESSAGE_REACTION_REMOVE
		 * - MESSAGE_REACTION_REMOVE_ALL
		 * - MESSAGE_REACTION_REMOVE_EMOJI
		 */
		[IntentsFlags.GuildMessageReactions]: 1 << 10,
		/**
		 * - TYPING_START
		 */
		[IntentsFlags.GuildMessageTyping]: 1 << 11,
		/**
		 * - CHANNEL_CREATE
		 * - MESSAGE_UPDATE
		 * - MESSAGE_DELETE
		 * - CHANNEL_PINS_UPDATE
		 */
		[IntentsFlags.DirectMessages]: 1 << 12,
		/**
		 * - MESSAGE_REACTION_ADD
		 * - MESSAGE_REACTION_REMOVE
		 * - MESSAGE_REACTION_REMOVE_ALL
		 * - MESSAGE_REACTION_REMOVE_EMOJI
		 */
		[IntentsFlags.DirectMessageReactions]: 1 << 13,
		/**
		 * - TYPING_START
		 */
		[IntentsFlags.DirectMessageTyping]: 1 << 14
	} as const;

	/**
	 * Project-Blue default intents, consisting of:
	 * - GUILDS
	 * - GUILD_BANS
	 * - GUILD_EMOJIS
	 * - GUILD_INTEGRATIONS
	 * - GUILD_WEBHOOKS
	 * - GUILD_INVITES
	 * - GUILD_VOICE_STATES
	 * - GUILD_MESSAGES
	 * - GUILD_MESSAGE_REACTIONS
	 * - DIRECT_MESSAGES
	 * - DIRECT_MESSAGE_REACTIONS
	 */
	public static DEFAULT = Intents.FLAGS[IntentsFlags.Guilds] |
		Intents.FLAGS[IntentsFlags.GuildBans] |
		Intents.FLAGS[IntentsFlags.GuildEmojis] |
		Intents.FLAGS[IntentsFlags.GuildIntegrations] |
		Intents.FLAGS[IntentsFlags.GuildWebhooks] |
		Intents.FLAGS[IntentsFlags.GuildInvites] |
		Intents.FLAGS[IntentsFlags.GuildVoiceStates] |
		Intents.FLAGS[IntentsFlags.GuildMessages] |
		Intents.FLAGS[IntentsFlags.GuildMessageReactions] |
		Intents.FLAGS[IntentsFlags.DirectMessages] |
		Intents.FLAGS[IntentsFlags.DirectMessageReactions];

	/**
	 * Project-Blue default intents, with the addition of the `GUILD_MEMBERS` flag
	 * Note: You need to enable support for it in the developer page of your bot
	 */
	public static DEFAULT_WITH_MEMBERS = Intents.DEFAULT | Intents.FLAGS[IntentsFlags.GuildMembers];

}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const Package = require('../../../package.json');
import { Intents } from './Intents';

import type { WSOptions } from '../lib/WebSocketManager';

const WebSocketID = `@klasa/ws v${Package.version}; Node.js/${process.version}`;

export const WSOptionsDefaults: Required<WSOptions> = {
	shards: 'auto',
	totalShards: null,
	intents: Intents.DEFAULT,
	additionalOptions: {
		// eslint-disable-next-line @typescript-eslint/camelcase
		large_threshold: 250,
		properties: {
			$os: process.platform,
			$browser: WebSocketID,
			$device: WebSocketID
		}
	},
	gatewayVersion: 6
};

import { isMainThread, parentPort, workerData, MessagePort } from 'worker_threads';

import { WebSocketConnection } from './WebSocketConnection';
import { MasterWorkerMessages, WSWorkerData, InternalActions } from '../types/InternalWebSocket';

const typedWorkerData = workerData as WSWorkerData;

function checkMainThread(port: unknown): asserts port is MessagePort {
	if (isMainThread || port === null) throw new Error('Worker can only be used as a WorkerThread');
}

checkMainThread(parentPort);

const connection = new WebSocketConnection(parentPort, typedWorkerData);

parentPort.on('message', (message: MasterWorkerMessages) => {
	switch (message.type) {
		case InternalActions.Identify: {
			connection.newSession();
			break;
		}
		case InternalActions.Destroy: {
			connection.destroy({ resetSession: true });
			break;
		}
		case InternalActions.Reconnect: {
			connection.destroy();
			break;
		}
		case InternalActions.PayloadDispatch: {
			connection.queueWSPayload(message.data);
			break;
		}
	}
});

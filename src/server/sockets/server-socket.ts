import * as io from 'socket.io';
import {Server} from 'http';
import {ResponseData, CredentialsData, RequestData } from '../socket-packets';
import * as express from 'express';

export class ServerSocket {
    private io: io.Server;
    private socketMap: {[socketId: string]: io.Socket}
    private sessionIdToSocketId: {[id: string]: string } = {};

    constructor(httpServer: Server) {
        this.io = new io.Server(httpServer);
        this.socketMap = {};
    }

    public onNetWorkEvent(eventName: string, callback: (param: any) => void) {

    }

    public getAllSockets(): io.Socket[] {
        return Object.values(this.socketMap);
    }

    public getAllSocketSessionIDs(): string[] {
        return Object.values(this.socketMap).map(s => (s.handshake as any).sessionID as string) as string[];
    }

    public getIDAddressOfConnectedSocket(socket: io.Socket): string {
        return socket.handshake.address;
    }

    public forceDisconnect(socket: io.Socket) {
        socket.disconnect(true);
    }

    public findSessionID(socketId: string) : string {
        for(const sid in this.sessionIdToSocketId) {
            const socketID = this.sessionIdToSocketId[sid];
            if(socketID === socketId)  {
                return sid;
            }
        }
        return '';
    }

    public getSocketBySessionID(sessionId: string) : io.Socket | null{
        const socketId = this.sessionIdToSocketId[sessionId];
        if(!socketId) {
            return null;
        }
        const socket = this.socketMap[socketId];
        if(!socket) {
            return null;
        }
        return socket;
    }

    public sendDataToSocket(socket: io.Socket, event: string, data: any) {
        if(!this.io) {
            return;
        }
        this.io.to(socket.id).emit(event, data);
    }

    public onNewConnection(connectionCallbacks: {
                onConnect: () => void,
                onJoin: (credentialsData: CredentialsData, socket: io.Socket) => void,
                onResetServer: (credentialsData: CredentialsData, socket: io.Socket) => void,
                onDisconnect:(socket: io.Socket) => void,
            }
        ) {
        this.io.on('connection', (socket) => {
            connectionCallbacks.onConnect();
            this.socketMap[socket.id] = socket;
            this.sessionIdToSocketId[(socket.handshake as any).sessionID] = socket.id;

            const onPrivateJoin = (data: RequestData) => {
                this.socketMap[socket.id] = socket;
                console.log(data, 'private-join');
                connectionCallbacks.onJoin(data as CredentialsData, socket);
            };

            socket.on('private-join', onPrivateJoin);

            const onResetServer =(data: RequestData) => {
                connectionCallbacks.onResetServer(data as CredentialsData, socket);
            };

            socket.on('reset-server', onResetServer);


            socket.on('disconnect', (data: RequestData) => {
                delete this.socketMap[socket.id];
                const sid = this.findSessionID(socket.id);
                delete this.sessionIdToSocketId[sid];

                socket.off('private-join', onPrivateJoin);
                socket.off('reset-server', onResetServer);

                connectionCallbacks.onDisconnect(socket);
            });
        }); 
    }

    public broadcast(responseData: ResponseData) {
        this.io.emit('broadcast', responseData);
    }
}
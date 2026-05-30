import express from 'express';
import * as exp from 'express';
import path from 'path';
import cors from 'cors';
import { config } from './environment/config/config';
import fs from 'fs';
import * as io from 'socket.io';
import http from 'http';
import { Routes } from './controllers/routes'
import { ServerSocket } from './sockets/server-socket'
import { CredentialsData, PlayerState, GameState, ObstacleState } from './socket-packets';

const COLORS = [
    0xff0000, 0x00ff00, 0x0000ff, 0xffff00, 0xff00ff, 0x00ffff, 0xffa500, 0x800080
];

export class NetworkHackServer {
    public static readonly PORT: number = config.serverPort || 2790;
    private app: exp.Application | null = null;
    private port: string | number = '';
    private server: http.Server | null = null;
    private serverSocket: ServerSocket | null = null;
    
    private players: Map<string, PlayerState> = new Map();
    private obstacles: Map<string, ObstacleState> = new Map();
    private colorIndex: number = 0;
    private catcherId: string | null = null;
    private caughtPlayerIds: Set<string> = new Set();
    private readyPlayers: Set<string> = new Set();
    private startTime?: number;
    private isGameOver: boolean = false;
    private inLobby: boolean = true;
    private catchDistance: number = 2.5;
    private singlePlayerTimer?: any;

    constructor() {
        this.createApp();
        this.configure();
        this.loadScene(); // Load after createApp to ensure path is ready
        this.createServer(); 
        this.initializeWebSockets();    
        this.initializeBackendServices();
        this.listen();
    }

    private getPublicPath(): string {
        // Correctly resolve the public path relative to the root directory
        const baseDir = process.cwd();
        if (config.public && config.public.length > 0) {
            return path.join(baseDir, 'dist', 'public');
        }
        return baseDir;
    }

    private getSceneFilePath(): string {
        return path.join(process.cwd(), 'scene.json');
    }

    private loadScene() {
        const filePath = this.getSceneFilePath();
        console.log(`Checking for scene.json at: ${filePath}`);
        if (fs.existsSync(filePath)) {
            try {
                const data = fs.readFileSync(filePath, 'utf8');
                const obsArray = JSON.parse(data);
                if (Array.isArray(obsArray)) {
                    obsArray.forEach((obs: ObstacleState) => {
                        if (obs.id) this.obstacles.set(obs.id, obs);
                    });
                    console.log(`Successfully loaded ${this.obstacles.size} obstacles from ${filePath}`);
                }
            } catch (e) {
                console.error(`Failed to load ${filePath}`, e);
            }
        } else {
            console.log("No existing scene.json found, starting with empty scene.");
        }
    }

    private saveScene() {
        console.log("Saving scene...");
        try {
            const filePath = this.getSceneFilePath();
            const obsArray = Array.from(this.obstacles.values());
            // Ensure the directory exists before writing
            const dir = path.dirname(filePath);
            console.log(`Saving scene with ${obsArray.length} obstacles to: ${filePath}`);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(filePath, JSON.stringify(obsArray, null, 2));
            console.log(`Saved ${obsArray.length} obstacles to ${filePath}`);
        } catch (e) {
            console.error("Failed to save scene.json", e);
        }
    }

    private initializeControllers() : void {}

    private initializeBackendServices(): void {
        this.initializeControllers();   
    }

    private initializeWebSockets(): void {
        this.serverSocket = new ServerSocket(this.server!);
        this.serverSocket.onNewConnection({
            onConnect: () => {},
            onJoin: async (data: CredentialsData, socket: io.Socket) => {
                console.log(`Player joined: ${socket.id}`);
                
                // Random position at the edges of the 25x25 ground
                const edge = Math.floor(Math.random() * 4);
                let startPos = { x: 0, y: 0.5, z: 0 };
                const spread = (Math.random() - 0.5) * 22; // Spread along the edge

                if (edge === 0) startPos = { x: -11, y: 0.5, z: spread }; // Left
                else if (edge === 1) startPos = { x: 11, y: 0.5, z: spread }; // Right
                else if (edge === 2) startPos = { x: spread, y: 0.5, z: -11 }; // Top
                else startPos = { x: spread, y: 0.5, z: 11 }; // Bottom

                const player: PlayerState = {
                    id: socket.id,
                    position: startPos,
                    quaternion: { x: 0, y: 0, z: 0, w: 1 },
                    color: COLORS[this.colorIndex % COLORS.length] || 0xffffff
                };
                this.colorIndex++;
                this.players.set(socket.id, player);

                if (this.serverSocket) {
                    this.serverSocket.sendDataToSocket(socket, 'init', { 
                        yourId: socket.id,
                        gameState: this.getGameState()
                    });
                }

                this.broadcastGameState();
                
                socket.on('start-game', () => {
                    if (this.inLobby) {
                        this.startGame();
                    }
                });

                socket.on('set-name', (name: string) => {
                    const p = this.players.get(socket.id);
                    if (p) {
                        p.name = name.substring(0, 16); // Limit name length
                        this.broadcastGameState();
                    }
                });

                socket.on('set-color', (color: number) => {
                    const p = this.players.get(socket.id);
                    if (p) {
                        p.color = color;
                        this.broadcastGameState();
                    }
                });

                socket.on('move-end', (data: any) => {
                    const p = this.players.get(socket.id);
                    if (p && !this.isPlayerCaught(socket.id)) {
                        p.position = data.position;
                        p.quaternion = data.quaternion;
                        this.tryCatchPlayers();
                        this.broadcastGameState();
                    }
                });

                socket.on('move-update', (data: any) => {
                    const p = this.players.get(socket.id);
                    if (p && !this.isPlayerCaught(socket.id)) {
                        p.position = data.position;
                        p.quaternion = data.quaternion;
                        this.tryCatchPlayers();
                        this.broadcastGameState();
                    }
                });

                socket.on('obstacle-add', (data: ObstacleState) => {
                    if (!data.id) return;
                    console.log(`Received obstacle-add: ${data.id}`);
                    this.obstacles.set(data.id, data);
                    this.saveScene();
                    this.broadcastGameState();
                });

                socket.on('obstacle-update', (data: ObstacleState) => {
                    if (!data.id) return;
                    console.log(`Received obstacle-update: ${data.id}`);
                    const existing = this.obstacles.get(data.id) || {} as ObstacleState;
                    // Preserve teleport properties during update if not provided
                    const updated = { ...existing, ...data };
                    this.obstacles.set(data.id, updated);
                    this.saveScene();
                    this.broadcastGameState();
                });
            },
            onResetServer: (data: CredentialsData, socket: io.Socket) => {},
             onDisconnect: async (socket: io.Socket) => {
                console.log(`Player disconnected: ${socket.id}`);
                this.players.delete(socket.id);
                this.caughtPlayerIds.delete(socket.id);
                if (this.catcherId === socket.id) {
                    const nextPlayer = this.players.keys().next();
                    this.catcherId = nextPlayer.done ? null : nextPlayer.value;
                    if (this.catcherId) {
                        console.log(`New catcher assigned: ${this.catcherId}`);
                    }
                }
                this.checkGameOver();
                this.broadcastGameState();
             },
        });
    }

    private getGameState(): GameState {
        return {
            players: Array.from(this.players.values()),
            obstacles: Array.from(this.obstacles.values()),
            catcherId: this.catcherId || undefined,
            caughtPlayerIds: Array.from(this.caughtPlayerIds),
            startTime: this.startTime,
            isGameOver: this.isGameOver,
            inLobby: this.inLobby,
            readyPlayers: Array.from(this.readyPlayers)
        };
    }

    private startGame(): void {
        this.inLobby = false;
        this.isGameOver = false;
        this.startTime = Date.now();
        this.caughtPlayerIds.clear();
        
        if (this.singlePlayerTimer) {
            clearTimeout(this.singlePlayerTimer);
            this.singlePlayerTimer = undefined;
        }

        // Pick a random catcher
        const playerIds = Array.from(this.players.keys());
        if (playerIds.length > 0) {
            this.catcherId = playerIds[Math.floor(Math.random() * playerIds.length)];
        }

        // Single player mode: Game lasts 30 seconds
        if (this.players.size === 1) {
            console.log('Single player game started: 30s limit active');
            this.singlePlayerTimer = setTimeout(() => {
                if (!this.inLobby && this.players.size === 1) {
                    this.triggerGameOver();
                }
            }, 30000);
        }

        // Randomize player positions at start of game
        this.players.forEach(p => {
            const edge = Math.floor(Math.random() * 4);
            const spread = (Math.random() - 0.5) * 45;
            if (edge === 0) p.position = { x: -22, y: 0.5, z: spread };
            else if (edge === 1) p.position = { x: 22, y: 0.5, z: spread };
            else if (edge === 2) p.position = { x: spread, y: 0.5, z: -22 };
            else p.position = { x: spread, y: 0.5, z: 22 };
        });

        console.log('Game started');
        this.broadcastGameState();
    }

    private resetToLobby(): void {
        this.inLobby = true;
        this.isGameOver = false;
        this.startTime = undefined;
        this.caughtPlayerIds.clear();
        this.readyPlayers.clear();
        if (this.singlePlayerTimer) {
            clearTimeout(this.singlePlayerTimer);
            this.singlePlayerTimer = undefined;
        }
        console.log('Returned to lobby');
        this.broadcastGameState();
    }

    private isPlayerCaught(playerId: string): boolean {
        return playerId !== this.catcherId && this.caughtPlayerIds.has(playerId);
    }

    private tryCatchPlayers(): void {
        if (this.inLobby || this.isGameOver || !this.catcherId) return;
        const catcher = this.players.get(this.catcherId);
        if (!catcher) return;

        for (const [id, player] of this.players.entries()) {
            if (id === this.catcherId) continue;
            if (this.caughtPlayerIds.has(id)) continue;

            const dx = player.position.x - catcher.position.x;
            const dy = player.position.y - catcher.position.y;
            const dz = player.position.z - catcher.position.z;
            const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (distance <= this.catchDistance) {
                this.caughtPlayerIds.add(id);
                console.log(`Player ${id} caught by ${this.catcherId}`);
            }
        }

        this.checkGameOver();
    }

    private triggerGameOver(): void {
        if (this.isGameOver) return;
        this.isGameOver = true;
        console.log('Game over triggered');
        this.broadcastGameState();
        
        // Wait 5 seconds then return to lobby
        setTimeout(() => {
            this.resetToLobby();
        }, 5000);
    }

    private checkGameOver(): void {
        if (this.inLobby || this.isGameOver) return;
        if (this.players.size === 0) {
            this.isGameOver = false;
            return;
        }

        // If only 1 player, game only ends via the 30s timer started in startGame
        if (this.players.size === 1) return;

        const allCaught = Array.from(this.players.keys()).every(id => {
            return id === this.catcherId || this.caughtPlayerIds.has(id);
        });

        if (allCaught) {
            this.triggerGameOver();
        }
    }

    private broadcastGameState(): void {
        if (this.serverSocket) {
            this.serverSocket.broadcast(this.getGameState() as any);
        }
    }

    private createApp(): void {
       this.app = express();
       this.app!.use(cors({ credentials: false }));
       const publicPath = this.getPublicPath();
       this.app!.use(express.static(publicPath));
       this.app!.get([Routes.HOME, Routes.PLAYER], (req, res) => {
            res.sendFile(path.join(publicPath, 'index.html'));
       });
    }

    private configure(): void {
        this.port = process.env.PORT || config.serverPort || NetworkHackServer.PORT;
    }

    private listen(): void {
        this.server!.listen(this.port, () => {
            console.log('Running data server on port %s', this.port);
        });
    }

    private createServer(): void {
        this.server = http.createServer(this.app!);
    }
}

export interface RequestData {
    
}

export interface ResponseData {

}

export interface CredentialsData extends RequestData {
    token?: string;
    role?: 'catcher' | 'player';
}

export interface Vector3 {
    x: number;
    y: number;
    z: number;
}

export interface Quaternion {
    x: number;
    y: number;
    z: number;
    w: number;
}

export interface PlayerState {
    id: string;
    name?: string;
    position: Vector3;
    quaternion: Quaternion;
    color: number;
}

export interface ObstacleState {
    id: string;
    position: Vector3;
    scale: Vector3;
    isTeleport?: boolean;
    pairId?: string;
    color?: number;
}

export interface GameState {
    players: PlayerState[];
    obstacles: ObstacleState[];
    catcherId?: string;
    caughtPlayerIds?: string[];
    startTime?: number;
    isGameOver?: boolean;
    inLobby?: boolean;
    readyPlayers?: string[];
}

export interface MoveEvent {
    direction: Vector3;
}

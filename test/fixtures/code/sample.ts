export interface Config {
    level: number;
}

export class DiagService {
    private level = 0;

    run(input: number): number {
        return input;
    }
}

export function createService(): DiagService {
    return new DiagService();
}

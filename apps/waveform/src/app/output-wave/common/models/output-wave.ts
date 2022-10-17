import { BehaviorSubject } from 'rxjs';

export class OutputWave extends BehaviorSubject<[number[], number[]]> {}

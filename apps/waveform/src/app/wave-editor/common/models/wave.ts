import { BehaviorSubject } from 'rxjs';

export class Wave extends BehaviorSubject<number[]> {
  setValue([i, value]: [number, number]) {
    const newWave = [...this.value];
    newWave[i] = value;
    this.next(newWave);
  }
}

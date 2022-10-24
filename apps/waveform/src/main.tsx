import React from 'react';
import * as ReactDOM from 'react-dom/client';
import { BehaviorSubject, map, mergeWith } from 'rxjs';
import { rxModel, useBehaviorSubject, Model, rxModelReact } from '@waveform/rxjs-react';
import { Handle } from '@waveform/ui-kit';

// 1
const $wavetable = new BehaviorSubject<number[]>([1, 2]);
const model1Fc = rxModel({ $wavetable }).actions(({ $wavetable }) => ({
  randomWave: () => $wavetable.next(new Array(Math.round(Math.random() * 50) + 1).fill(Math.random())),
}));

const model1Wrapper = () => model1Fc;
type Module1Type = Model<ReturnType<typeof model1Fc.init>[0], ReturnType<typeof model1Fc.init>[1]>;
const { useModel: useModel1, ModelProvider: Model1Provider } = rxModelReact('model1', model1Wrapper);

const Model1Intrnal = () => {
  const model1 = useModel1();
  const [{ $wavetable }, { randomWave }] = model1;
  const wavetable = useBehaviorSubject($wavetable);
  return (
    <div style={{ margin: 30 }}>
      <div>Model 1</div>
      <button onClick={randomWave}>randomWave()</button>
      <div>{wavetable.join('||| ')}</div>

      <Model2 />
    </div>
  );
};

const Model1 = () => (
  <Model1Provider>
    <Model1Intrnal />
  </Model1Provider>
);
// 2
const $rate = new BehaviorSubject<number>(4);
const $croppedWave = new BehaviorSubject<number[]>([]);
const model2Fc = ({ model1: [{ $wavetable }] }: { model1: Module1Type }) =>
  rxModel({ $rate, $croppedWave })
    .actions(({ $rate }) => ({
      randomRate: () => $rate.next(Math.round(Math.random() * 100)),
      setRate: (value: number) => $rate.next(value),
    }))
    .subscriptions(({ $rate, $croppedWave }) =>
      $wavetable
        .pipe(
          mergeWith($rate),
          map(() => {
            const newWave = [...$wavetable.value];
            newWave.splice($rate.value);
            return newWave;
          })
        )
        .subscribe($croppedWave)
    );
const { useModel: useModel2, ModelProvider } = rxModelReact('model2', model2Fc);

const Model2Internal = () => {
  const [{ $rate, $croppedWave }, { setRate }] = useModel2();
  const rate = useBehaviorSubject($rate);
  const croppedWave = useBehaviorSubject($croppedWave);
  return (
    <div style={{ margin: 30 }}>
      <div>Model 2</div>
      <Handle value={rate} onChange={setRate} />
      <div>{rate}</div>
      <div>{croppedWave.join('||| ')}</div>
    </div>
  );
};

const Model2 = React.memo(() => {
  const model1 = useModel1();
  return (
    <ModelProvider model1={model1}>
      <Model2Internal />
    </ModelProvider>
  );
});

// Control

const Control = () => {
  const [m1, setM1] = React.useState(true);
  const [handle, setHandle] = React.useState(0);
  return (
    <div>
      <div>
        <button onClick={() => setM1(!m1)}>toggle model 1</button>
      </div>
      {m1 && <Model1 />}
      <Handle value={handle} onChange={setHandle} />
    </div>
  );
};

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(<Control />);

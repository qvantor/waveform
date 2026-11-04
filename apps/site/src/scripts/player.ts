import { clock } from './clock';

// The players of the clips (DemoCard.astro): a play key, the wave (a slider of the position) and an <audio> of
// preload none, so nothing loads before a press. One clip plays at a time: a clip that starts pauses the others.
// The page reads in full without this script; only the keys need it.

// a step of the arrows on the wave, seconds
export const SEEK_STEP = 5;

type Player = {
  root: HTMLElement;
  audio: HTMLAudioElement;
  play: HTMLButtonElement;
  wave: HTMLElement;
  // the clip rectangle of the played part of the wave
  progress: SVGRectElement;
  // the width of the wave in the units of its viewBox
  span: number;
  duration: number;
};

const playerOf = (root: HTMLElement): Player | null => {
  const audio = root.querySelector<HTMLAudioElement>('audio');
  const play = root.querySelector<HTMLButtonElement>('[data-play]');
  const wave = root.querySelector<HTMLElement>('[data-wave]');
  const progress = root.querySelector<SVGRectElement>('[data-progress]');
  if (!audio || !play || !wave || !progress) return null;
  // the length of the clip is known before it loads (peaks.json)
  const duration = Number(root.dataset['duration']);
  const span = Number(wave.dataset['span']);
  return { root, audio, play, wave, progress, span, duration };
};

const show = ({ audio, wave, progress, span, duration }: Player) => {
  const time = Math.min(audio.currentTime, duration);
  const share = duration > 0 ? time / duration : 0;
  progress.setAttribute('width', String(share * span));
  wave.setAttribute('aria-valuenow', String(Math.round(time)));
  wave.setAttribute('aria-valuetext', `${clock(time)} / ${clock(duration)}`);
};

const seek = (player: Player, time: number) => {
  player.audio.currentTime = Math.min(Math.max(0, time), player.duration);
  show(player);
};

// a promise of play() rejects when a pause comes first or the browser refuses: nothing to do then
const start = (audio: HTMLAudioElement) => {
  const playing = audio.play();
  if (playing) playing.catch(() => undefined);
};

export const initPlayers = (root: ParentNode = document) => {
  const players = [...root.querySelectorAll<HTMLElement>('[data-player]')]
    .map(playerOf)
    .filter((player): player is Player => player !== null);
  let frame = 0;

  // the played part follows the time every frame while a clip plays (timeupdate comes 4 times a second)
  const follow = () => {
    const playing = players.find((player) => !player.audio.paused);
    if (!playing) {
      frame = 0;
      return;
    }
    show(playing);
    frame = requestAnimationFrame(follow);
  };

  for (const player of players) {
    const { audio, play, wave, root: element } = player;
    play.addEventListener('click', () => (audio.paused ? start(audio) : audio.pause()));
    audio.addEventListener('play', () => {
      for (const other of players) if (other !== player && !other.audio.paused) other.audio.pause();
      play.setAttribute('aria-pressed', 'true');
      element.classList.add('playing');
      if (!frame) frame = requestAnimationFrame(follow);
    });
    audio.addEventListener('pause', () => {
      play.setAttribute('aria-pressed', 'false');
      element.classList.remove('playing');
      show(player);
    });
    audio.addEventListener('timeupdate', () => show(player));
    audio.addEventListener('ended', () => seek(player, 0));
    // a press on the wave plays from there
    wave.addEventListener('click', (event) => {
      const box = wave.getBoundingClientRect();
      if (box.width <= 0) return;
      seek(player, ((event.clientX - box.left) / box.width) * player.duration);
      if (audio.paused) start(audio);
    });
    wave.addEventListener('keydown', (event) => {
      const time = audio.currentTime;
      const to: Record<string, number> = {
        ArrowLeft: time - SEEK_STEP,
        ArrowDown: time - SEEK_STEP,
        ArrowRight: time + SEEK_STEP,
        ArrowUp: time + SEEK_STEP,
        Home: 0,
        End: player.duration,
      };
      const target = to[event.key];
      if (target === undefined) return;
      event.preventDefault();
      seek(player, target);
    });
    show(player);
  }
  return players.length;
};

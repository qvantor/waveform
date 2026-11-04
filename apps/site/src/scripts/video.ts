// The video of the synth (Hero.astro): it loads nothing before it is seen (preload none, its first frame as the
// poster), plays once PLAY_SHARE of it is on screen (not for its edge peeking under the first section) and pauses
// once it is off screen; it stays its poster where the reader asked for reduced motion or to save data, and without
// this script.

export const PLAY_SHARE = 0.3;

type Connection = { saveData?: boolean };

export const playWhenSeen = (root: ParentNode = document) => {
  const videos = [...root.querySelectorAll<HTMLVideoElement>('video[data-autoplay]')];
  if (!videos.length) return 0;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return 0;
  if ((navigator as Navigator & { connection?: Connection }).connection?.saveData) return 0;
  const observer = new IntersectionObserver(
    (entries) => {
      for (const { target, isIntersecting, intersectionRatio } of entries) {
        const video = target as HTMLVideoElement;
        if (intersectionRatio >= PLAY_SHARE) video.play()?.catch(() => undefined);
        else if (!isIntersecting) video.pause();
      }
    },
    { threshold: [0, PLAY_SHARE] }
  );
  for (const video of videos) observer.observe(video);
  return videos.length;
};

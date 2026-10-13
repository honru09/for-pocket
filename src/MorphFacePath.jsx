import React, { useLayoutEffect, useRef } from 'react';
import { facePath } from './mascot-face.mjs';

export default function MorphFacePath({ pose, kind, className }) {
  const nodeRef = useRef(null), current = useRef(pose);
  useLayoutEffect(() => {
    const node = nodeRef.current, from = current.current;
    if (from === pose) return;
    // WAAPI supplies the existing easing and clock. Update only two tiny SVG
    // paths per display frame; React never rerenders for the animation frames.
    const easing = getComputedStyle(node).getPropertyValue('--ease-out').trim();
    const timing = node.animate([{ opacity:1 }, { opacity:1 }], { duration:180, easing, fill:'both' });
    let frame;
    const draw = () => {
      const progress = timing.effect.getComputedTiming().progress;
      if (progress != null) {
        current.current = from.map((value,index) => value + (pose[index] - value) * progress);
        node.setAttribute('d', facePath(current.current, kind));
      }
      if (timing.playState === 'finished') {
        current.current = pose;
        node.setAttribute('d', facePath(pose, kind));
      } else frame = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(frame); timing.cancel(); };
  }, [pose, kind]);
  return <path ref={nodeRef} className={className} d={facePath(current.current, kind)}/>;
}

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Input } from '@telegram-apps/telegram-ui';
import { Sheet } from './AccountViews.jsx';
import cashBundle from '../public/assets/note-cash-bundle-v1.webp';

const EXIT_MS = 160;

export default function NoteEntrySheet({ t, note, disabled, canSave, saveLabel, onChange, onSubmit, onClose }) {
  // Keep the submitted text visible during the fade even as save clears the
  // next entry's draft. The parent unmounts us on a ledger/account change.
  const [text, setText] = useState(note);
  const [closing, setClosing] = useState(false);
  const locked = useRef(false), composing = useRef(false), timer = useRef(null), image = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const close = () => {
    if (locked.current) return;
    locked.current = true; setClosing(true);
    timer.current = setTimeout(onClose, EXIT_MS);
  };
  const submit = event => {
    event.preventDefault();
    if (locked.current || composing.current || !canSave) return;
    const box = image.current?.getBoundingClientRect();
    if (!onSubmit(box ? {x:box.x+box.width/2,y:box.y+box.height/2,size:box.width} : null)) return;
    document.activeElement?.blur();
    close();
  };
  return <Sheet title={t('noteTitle')} className={`note-sheet${closing ? ' is-closing' : ''}`} onClose={close}>
    <form className="note-form" onSubmit={submit}>
      <Input id="note" className="note-field" autoFocus aria-label={t('note')} placeholder={t('notePlaceholder')}
        value={text} maxLength={160} disabled={disabled || closing}
        onCompositionStart={() => {composing.current=true;}}
        onCompositionEnd={() => {composing.current=false;}}
        onKeyDown={event => { if (event.key === 'Enter' && (composing.current || event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault(); }}
        onChange={event => {setText(event.target.value);onChange(event.target.value);}}/>
      <Button type="submit" className="note-submit" disabled={!canSave || closing} aria-label={saveLabel} title={saveLabel}>
        <img ref={image} src={cashBundle} alt="" draggable="false" width="64" height="64"/>
      </Button>
    </form>
  </Sheet>;
}

export function NoteCashFlight({ event, onArrive }) {
  const ref = useRef(null), arrive = useRef(onArrive);
  arrive.current = onArrive;
  useEffect(() => {
    let frame, started, cancelled = false;
    const source = event.origin;
    const node = ref.current;
    // Wait only for the modal to leave the top layer; saving already happened.
    const timer = setTimeout(() => {
      const step = now => {
        if (cancelled) return;
        started ??= now;
        const target = document.querySelector('.mascot-stack');
        if (!target) { arrive.current(event); return; }
        const box = target.getBoundingClientRect();
        const progress = Math.min(1,(now-started)/520);
        const t = 1-Math.pow(1-progress,3), u = 1-t;
        const end = {x:box.x+box.width*.475,y:box.y+box.height*.795};
        const control = {x:source.x+(end.x-source.x)*.25-28,y:Math.min(source.y,end.y)-72};
        const x = u*u*source.x+2*u*t*control.x+t*t*end.x;
        const y = u*u*source.y+2*u*t*control.y+t*t*end.y;
        const scale = (source.size+(box.width*.43-source.size)*t)/64;
        // A single geometric read precedes compositor-only writes. Updating
        // the destination follows keyboard dismissal without stale endpoints.
        node.style.transform = `translate3d(${x-32}px,${y-32}px,0) rotate(${-16*Math.sin(Math.PI*t)}deg) scale(${scale})`;
        node.style.opacity = String(Math.min(1,progress*12));
        if (progress < 1) frame = requestAnimationFrame(step);
        else arrive.current(event);
      };
      frame = requestAnimationFrame(step);
    }, EXIT_MS);
    return () => {cancelled=true;clearTimeout(timer);cancelAnimationFrame(frame);};
  }, [event]);
  return createPortal(<img ref={ref} className="note-cash-flight" src={cashBundle} alt="" aria-hidden="true"/>,document.body);
}

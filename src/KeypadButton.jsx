import React, { memo, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { Tappable } from '@telegram-apps/telegram-ui';

const activationKey = event => event.key === 'Enter' ? 'Enter' : [' ', 'Space', 'Spacebar'].includes(event.key) || event.code === 'Space' ? 'Space' : null;
const within = (rect, event) => event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;

// Pointer input commits at a valid release; its compatibility click never
// commits again. Keyboard and assistive-technology clicks keep button semantics.
export default memo(function KeypadButton({ keyValue, children, label, disabled, contextKey, pointerSession, onInput, onVisualChange, secondary = false }) {
  const buttonRef = useRef(null), pointer = useRef(null), keyboard = useRef(null);
  const latest = useRef({ disabled, onInput });
  latest.current = { disabled, onInput };
  const paint = useCallback((pressed, source) => onVisualChange(keyValue, pressed, source), [keyValue, onVisualChange]);
  const finishPointer = useCallback((session, commit = false) => {
    if (pointer.current !== session) return;
    pointer.current = null;
    if (pointerSession.current === session) pointerSession.current = null;
    session.detach();
    paint(false, 'pointer');
    try { if (session.node.hasPointerCapture?.(session.id)) session.node.releasePointerCapture(session.id); } catch {}
    if (commit && !latest.current.disabled && session.node.isConnected) latest.current.onInput(keyValue);
  }, [keyValue, paint, pointerSession]);
  const cancel = useCallback(() => {
    if (pointer.current) finishPointer(pointer.current);
    if (keyboard.current) keyboard.current.cancelled = true;
    paint(false, 'keyboard');
  }, [finishPointer, paint]);

  useLayoutEffect(() => {
    cancel();
    return cancel;
  }, [contextKey, disabled, cancel]);
  useEffect(() => {
    const hidden = () => { if (document.hidden) cancel(); };
    window.addEventListener('blur', cancel);
    document.addEventListener('visibilitychange', hidden);
    return () => { window.removeEventListener('blur', cancel); document.removeEventListener('visibilitychange', hidden); };
  }, [cancel]);

  const down = event => {
    if (latest.current.disabled || event.button !== 0) return;
    if (event.isPrimary === false || pointerSession.current) { event.preventDefault(); return; }
    const node = event.currentTarget;
    const session = { id:event.pointerId, node, rect:node.getBoundingClientRect(), cancelled:false, detach:() => {} };
    session.cancel = () => finishPointer(session);
    pointer.current = session;
    pointerSession.current = session;
    if (keyboard.current) keyboard.current.cancelled = true;
    paint(true, 'pointer');
    const inside = next => within(session.rect, next) && within(node.getBoundingClientRect(), next);
    const move = next => {
      if (next.pointerId !== session.id || pointer.current !== session || session.cancelled) return;
      if (!inside(next)) { session.cancelled = true; paint(false, 'pointer'); }
    };
    const up = next => {
      if (next.pointerId === session.id) finishPointer(session, !session.cancelled && inside(next));
    };
    const interrupted = next => { if (next.pointerId === session.id) finishPointer(session); };
    // Window listeners also cover WebViews where pointer capture is unavailable.
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', interrupted, true);
    session.detach = () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', interrupted, true);
    };
    try { node.setPointerCapture?.(session.id); } catch {}
  };
  const keyDown = event => {
    const key = activationKey(event);
    if (!key) return;
    if (latest.current.disabled || event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.isComposing || event.nativeEvent.isComposing || (keyboard.current && !keyboard.current.cancelled)) {
      event.preventDefault();
      return;
    }
    pointerSession.current?.cancel();
    keyboard.current = { key, cancelled:false, committed:false };
    paint(true, 'keyboard');
  };
  const keyUp = event => {
    if (!keyboard.current || keyboard.current.key !== activationKey(event)) return;
    if (keyboard.current.cancelled) event.preventDefault();
    keyboard.current = null;
    paint(false, 'keyboard');
  };
  const click = event => {
    const fromPointer = event.detail > 0 || Boolean(event.nativeEvent.pointerType);
    if (fromPointer || event.button > 0 || latest.current.disabled) { event.preventDefault(); return; }
    const held = keyboard.current;
    if (held && !held.cancelled) {
      if (held.committed) { event.preventDefault(); return; }
      held.committed = true;
    }
    // Switching input source retires any held key before entering this one.
    // Its eventual pointerup/compatibility click must not add a trailing digit.
    pointerSession.current?.cancel();
    paint(true, 'keyboard');
    latest.current.onInput(keyValue);
    if (!held || held.cancelled) paint(false, 'keyboard');
  };

  return <Tappable ref={buttonRef} Component="button" type="button" className={`key ${secondary ? 'key-secondary' : ''}`} data-key={keyValue} disabled={disabled} aria-label={label}
    onPointerDown={down}
    onPointerLeave={event => {
      const current = pointer.current;
      if (current?.id === event.pointerId && !within(current.rect, event)) { current.cancelled = true; paint(false, 'pointer'); }
    }}
    onLostPointerCapture={event => { if (pointer.current?.id === event.pointerId) finishPointer(pointer.current); }}
    onKeyDown={keyDown} onKeyUp={keyUp} onBlur={cancel} onClick={click}>
    <span className="key-cap"><span className="key-label">{children}</span></span>
  </Tappable>;
});

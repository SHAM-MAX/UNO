// Browser/Android Back follows app screens without rewinding authoritative games.
export function initBackNavigation(app) {
  const owned = state => state?.unoNavigation === true;
  let current = owned(history.state) ? history.state : { unoNavigation:true, depth:0, screen:'home' };
  let applying = false;
  let pendingLeaveTarget = null;
  history.replaceState(current, '', location.href);

  function urlFor(state) {
    const url = new URL(location.href);
    url.searchParams.delete('room');
    if (state.screen === 'room' && state.roomId) url.searchParams.set('room', state.roomId);
    return url;
  }
  function write(next, replace = false) {
    current = { unoNavigation:true, ...next, depth:replace ? current.depth : current.depth + 1 };
    history[replace ? 'replaceState' : 'pushState'](current, '', urlFor(current));
  }
  function screen(next) {
    if (applying) return;
    if (current.screen === next.screen && current.mode === next.mode && current.roomId === next.roomId && !current.modal) return;
    write(next, current.screen === 'room' && next.screen === 'room');
  }
  function wrap(name, after) {
    const original = app[name].bind(app);
    app[name] = (...args) => {
      const result = original(...args);
      if (!applying) after(...args);
      return result;
    };
  }
  function render(target) {
    applying = true;
    try {
      app.closeSettingsModal();
      app.closeLeaveConfirm();
      app.closeAiSetup();
      if (target.screen === 'room' && !app.roomId) target = { ...target, screen:'home', modal:null, roomId:null };
      if (target.screen === 'mode') app.openModeSetup(target.mode);
      else if (target.screen === 'ai') { app.showModePicker(); app.openAiSetup(); }
      else if (target.screen === 'home') app.showModePicker();
      if (target.modal === 'settings') app.openSettingsModal(target.tab || 'general');
      if (target.modal === 'leave' && app.roomId) app.leaveRoom();
      current = target;
      history.replaceState(current, '', urlFor(current));
    } finally { applying = false; }
  }

  wrap('openModeSetup', mode => screen({ screen:'mode', mode }));
  wrap('openAiSetup', () => screen({ screen:'ai' }));
  wrap('showModePicker', () => {
    if (['mode','ai'].includes(current.screen) && !app.roomId && current.depth > 0) history.back();
    else if (!app.roomId && current.screen !== 'home') screen({ screen:'home' });
  });
  wrap('closeAiSetup', () => {
    if (current.screen === 'ai' && !app.roomId && current.depth > 0) history.back();
  });
  wrap('handleRoomState', () => {
    if (app.roomId && (current.screen !== 'room' || current.roomId !== app.roomId)) screen({ screen:'room', roomId:app.roomId });
  });
  wrap('openSettingsModal', tab => {
    if (current.modal === 'settings') write({ ...current, tab }, true);
    else write({ ...current, modal:'settings', tab });
  });
  wrap('closeSettingsModal', () => {
    if (current.modal === 'settings') history.back();
  });
  wrap('leaveRoom', () => {
    if (current.modal !== 'leave') write({ ...current, modal:'leave' });
  });
  wrap('closeLeaveConfirm', () => {
    if (current.modal === 'leave') history.back();
  });

  const leave = app.confirmLeaveRoom.bind(app);
  app.confirmLeaveRoom = () => {
    const origin = current;
    const target = pendingLeaveTarget || { unoNavigation:true, depth:0, screen:'home' };
    pendingLeaveTarget = null;
    applying = true;
    try { leave(); } finally { applying = false; }
    if (origin.depth > target.depth) history.go(target.depth - origin.depth);
    else render(target);
  };

  window.addEventListener('popstate', event => {
    if (!owned(event.state)) return;
    const target = event.state;
    if (app.roomId && current.screen === 'room' && target.screen !== 'room') {
      // Restore the room entry while the player decides whether to leave.
      pendingLeaveTarget = target;
      applying = true;
      try { app.closeSettingsModal(); } finally { applying = false; }
      current = { ...current, depth:target.depth, modal:null };
      write({ screen:'room', roomId:app.roomId });
      app.leaveRoom();
      return;
    }
    pendingLeaveTarget = null;
    render(target);
  });

  // Restore non-room routes after a reload; room reconnection stays with the app.
  if (current.screen !== 'room' && !new URL(location.href).searchParams.has('room')) render(current);
}

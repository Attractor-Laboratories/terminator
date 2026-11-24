// Native menu content: every workspace (each with its own goals and terminals in a submenu),
// then the current workspace's goals and terminals in the sidebar's saved order.
function menuTemplate({workspace, sessions, order = {}, selected, workspaces, orders = {}}, activate) {
  const current = workspaceSections({workspace, sessions, order, selected}, activate);
  const list = (workspaces || []).filter(w => !w.archived);
  if (!list.length) return current;
  const text = value => String(value || '').replace(/[\r\n\t]+/g, ' ');
  const items = list.map(w => {
    const count = sessions.filter(s => s.workspaceId === w.id).length, active = w.id === workspace?.id;
    return {label: `${active ? '✓ ' : '    '}${text(w.title)}  (${count})`, submenu: [
      {label: active ? 'Show this workspace' : 'Switch to this workspace', click: () => activate({kind: 'workspace', workspaceId: w.id})},
      {type: 'separator'},
      ...workspaceSections({workspace: w, sessions, order: orders[w.id] || {}, selected: active ? selected : null}, activate),
    ]};
  });
  return [{label: 'Workspaces', enabled: false}, ...items, {type: 'separator'}, ...current];
}
function workspaceSections({workspace, sessions, order = {}, selected}, activate) {
  const text = value => String(value || '').replace(/[\r\n\t]+/g, ' ');
  const available = sessions.filter(s => s.workspaceId === workspace?.id);
  const byId = new Map(available.map(s => [s.id, s]));
  const priority = [...new Set(order.priority || [])].filter(id => byId.has(id));
  const rest = [...new Set([...(order.rest || []), ...available.map(s => s.id)])]
    .filter(id => byId.has(id) && !priority.includes(id));
  const terminal = (id, index, numbered) => {
    const s = byId.get(id);
    return {label: `${numbered ? `${index + 1}. ` : ''}${text(s.title)}`,
      type: 'checkbox', checked: id === selected,
      click: () => activate({kind: 'terminal', id, workspaceId: workspace.id})};
  };
  const section = (label, items) => [
    {label, enabled: false},
    ...(items.length ? items : [{label: '—', enabled: false}]),
  ];
  return [
    ...section('Goals', (workspace?.goals || []).map(goal => ({
      label: `${text(goal.text)} · ${goal.progress || 0}%`,
      click: () => activate({kind: 'goal', id: goal.id, workspaceId: workspace.id}),
    }))),
    {type: 'separator'},
    ...section('Priority', priority.map((id, i) => terminal(id, i, true))),
    {type: 'separator'},
    ...section('Rest', rest.map((id, i) => terminal(id, i, false))),
  ];
}

function menuBarIcon(nativeImage) {
  // 18pt template glyph, drawn at 2x so macOS can tint it for either menu bar theme.
  const size = 36, pixels = Buffer.alloc(size * size * 4);
  const dot = (x, y) => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const px = x + dx, py = y + dy;
      if (px >= 0 && px < size && py >= 0 && py < size) pixels[(py * size + px) * 4 + 3] = 255;
    }
  };
  for (let i = 0; i <= 8; i++) { dot(6 + i, 9 + i); dot(14 - i, 17 + i); }
  for (let x = 20; x <= 29; x++) dot(x, 25);
  const icon = nativeImage.createFromBitmap(pixels, {width: size, height: size, scaleFactor: 2});
  icon.setTemplateImage(true);
  return icon;
}

function createMenuBar({Tray, Menu, nativeImage}, snapshot, activate) {
  const tray = new Tray(menuBarIcon(nativeImage));
  tray.setToolTip('Terminator');
  const open = () => tray.popUpContextMenu(Menu.buildFromTemplate(menuTemplate(snapshot(), activate)));
  tray.on('click', open);
  tray.on('right-click', open);
  return tray;
}

module.exports = {menuTemplate, menuBarIcon, createMenuBar};

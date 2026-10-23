// Ready-made Nextion layouts used by the examples and the Nextion tab.
import { NX_COLORS, NX_DEFAULTS, emptyNextionProject, type NextionProject, type NxComponent, type NxPage, type NxType } from '../engine/devices/nextion';

const C = { ...NX_COLORS, DARK: 8484, PANEL: 12678, TEAL: 1300, ORANGE: 64512, LIGHTGRAY: 50712 };

function comp(page: NxPage, type: NxType, name: string, x: number, y: number, w: number, h: number, attrs: Record<string, any> = {}, ev: Partial<Pick<NxComponent, 'press' | 'release' | 'timer'>> = {}): NxComponent {
  const id = page.components.length + 1;
  const c: NxComponent = {
    id,
    name,
    type,
    x,
    y,
    w,
    h,
    attrs: { ...NX_DEFAULTS[type].attrs, ...attrs },
    press: ev.press ?? { sendId: false, code: '' },
    release: ev.release ?? { sendId: false, code: '' },
    timer: ev.timer,
  };
  page.components.push(c);
  return c;
}

const label = (p: NxPage, name: string, x: number, y: number, w: number, txt: string, h = 20) =>
  comp(p, 'text', name, x, y, w, h, { txt, bco: C.DARK, pco: C.LIGHTGRAY, font: 0, xcen: 0 });
const value = (p: NxPage, name: string, x: number, y: number, w: number, txt = '--', h = 26) =>
  comp(p, 'text', name, x, y, w, h, { txt, bco: C.PANEL, pco: C.WHITE, font: 2, xcen: 1 });

/** City Farming controller UI: dashboard, relay control, settings, QR. */
export function farmNextionTemplate(dashboardUrl = 'http://raspberrypi.local:5000'): NextionProject {
  const nx = emptyNextionProject();
  nx.pages = [];
  const p0: NxPage = { id: 0, name: 'main', bco: C.DARK, components: [] };
  comp(p0, 'text', 'tTitle', 0, 0, 220, 24, { txt: 'CITY FARM', bco: C.TEAL, pco: C.WHITE, font: 1, xcen: 0 });
  comp(p0, 'text', 'tTime', 220, 0, 100, 24, { txt: '00:00:00', bco: C.TEAL, pco: C.WHITE, font: 1 });
  label(p0, 'lTemp', 4, 28, 76, 'Air °C');
  value(p0, 'tTemp', 4, 46, 76);
  label(p0, 'lHum', 84, 28, 76, 'Humidity %');
  value(p0, 'tHum', 84, 46, 76);
  label(p0, 'lCO2', 164, 28, 76, 'CO2 ppm');
  value(p0, 'tCO2', 164, 46, 76);
  label(p0, 'lPH', 244, 28, 72, 'pH');
  value(p0, 'tPH', 244, 46, 72);
  label(p0, 'lEC', 4, 76, 76, 'EC mS/cm');
  value(p0, 'tEC', 4, 94, 76);
  label(p0, 'lLvl', 84, 76, 156, 'Water level %');
  comp(p0, 'progress', 'jLevel', 84, 96, 120, 22, { val: 0, bco: C.PANEL, pco: C.BLUE });
  comp(p0, 'number', 'nLevel', 206, 94, 34, 26, { val: 0, bco: C.PANEL, pco: C.WHITE, font: 1 });
  label(p0, 'lDay', 244, 76, 72, 'Grow day');
  comp(p0, 'number', 'nDay', 244, 94, 72, 26, { val: 0, bco: C.PANEL, pco: C.GREEN, font: 2 });
  label(p0, 'lMode', 4, 124, 60, 'Mode');
  comp(p0, 'text', 'tMode', 64, 124, 120, 22, { txt: 'AUTO', bco: C.PANEL, pco: C.YELLOW, font: 1 });
  label(p0, 'lNext', 188, 124, 128, 'Next irrigation');
  comp(p0, 'text', 'tNext', 188, 146, 128, 22, { txt: '--:--', bco: C.PANEL, pco: C.WHITE, font: 1 });
  comp(p0, 'text', 'tAlarm', 4, 150, 180, 22, { txt: 'OK', bco: C.GREEN, pco: C.BLACK, font: 1 });
  comp(p0, 'button', 'bControl', 4, 196, 100, 40, { txt: 'Control', bco: C.PANEL, pco: C.WHITE, bco2: C.TEAL, pco2: C.WHITE, font: 1 }, { press: { sendId: true, code: '' }, release: { sendId: false, code: 'page 1' } });
  comp(p0, 'button', 'bSettings', 110, 196, 100, 40, { txt: 'Settings', bco: C.PANEL, pco: C.WHITE, bco2: C.TEAL, pco2: C.WHITE, font: 1 }, { press: { sendId: true, code: '' }, release: { sendId: false, code: 'page 2' } });
  comp(p0, 'button', 'bQR', 216, 196, 100, 40, { txt: 'Web QR', bco: C.PANEL, pco: C.WHITE, bco2: C.TEAL, pco2: C.WHITE, font: 1 }, { press: { sendId: true, code: '' }, release: { sendId: false, code: 'page 3' } });
  nx.pages.push(p0);

  const p1: NxPage = { id: 1, name: 'control', bco: C.DARK, components: [] };
  comp(p1, 'text', 'tTitle', 0, 0, 320, 24, { txt: 'MANUAL CONTROL / RELAYS', bco: C.TEAL, pco: C.WHITE, font: 1 });
  const relays = [
    ['btPump', 'Pump'],
    ['btLight', 'Light'],
    ['btFan', 'Fan'],
    ['btHeat', 'Heater'],
  ];
  relays.forEach(([n, txt], i) =>
    comp(p1, 'dualstate', n, 8 + (i % 2) * 156, 32 + Math.floor(i / 2) * 52, 148, 44, { txt, val: 0, bco: C.PANEL, bco2: C.GREEN, pco: C.WHITE, pco2: C.BLACK, font: 1 }, { press: { sendId: true, code: '' } }),
  );
  comp(p1, 'button', 'bAuto', 8, 140, 148, 40, { txt: 'AUTO mode', bco: C.PANEL, pco: C.WHITE, bco2: C.TEAL, pco2: C.WHITE, font: 1 }, { press: { sendId: true, code: '' } });
  comp(p1, 'button', 'bManual', 164, 140, 148, 40, { txt: 'MANUAL mode', bco: C.PANEL, pco: C.WHITE, bco2: C.TEAL, pco2: C.WHITE, font: 1 }, { press: { sendId: true, code: '' } });
  comp(p1, 'text', 'tMode', 8, 186, 304, 20, { txt: 'Mode: AUTO', bco: C.DARK, pco: C.YELLOW, font: 0 });
  comp(p1, 'button', 'bBack', 8, 208, 100, 30, { txt: '< Back', bco: C.PANEL, pco: C.WHITE, bco2: C.TEAL, pco2: C.WHITE, font: 1 }, { press: { sendId: true, code: '' }, release: { sendId: false, code: 'page 0' } });
  nx.pages.push(p1);

  const p2: NxPage = { id: 2, name: 'settings', bco: C.DARK, components: [] };
  comp(p2, 'text', 'tTitle', 0, 0, 320, 24, { txt: 'SETTINGS', bco: C.TEAL, pco: C.WHITE, font: 1 });
  label(p2, 'lCrop', 8, 32, 80, 'Crop');
  comp(p2, 'text', 'tCrop', 90, 30, 222, 24, { txt: 'Lettuce', bco: C.PANEL, pco: C.WHITE, font: 1 });
  label(p2, 'lThr', 8, 62, 304, 'Thresholds (set from the web dashboard)');
  comp(p2, 'text', 'tThr', 8, 82, 304, 44, { txt: 'T 18-28 °C  pH 5.5-6.5  EC 1.0-2.0', bco: C.PANEL, pco: C.WHITE, font: 0, xcen: 0, ycen: 0 });
  label(p2, 'lDay', 8, 134, 120, 'Grow day');
  comp(p2, 'number', 'nDay', 130, 130, 60, 28, { val: 0, bco: C.PANEL, pco: C.GREEN, font: 2 });
  comp(p2, 'button', 'bResetDay', 196, 130, 116, 30, { txt: 'Reset day', bco: C.ORANGE, pco: C.BLACK, bco2: C.RED, pco2: C.WHITE, font: 1 }, { press: { sendId: true, code: '' } });
  comp(p2, 'button', 'bBack', 8, 208, 100, 30, { txt: '< Back', bco: C.PANEL, pco: C.WHITE, bco2: C.TEAL, pco2: C.WHITE, font: 1 }, { press: { sendId: true, code: '' }, release: { sendId: false, code: 'page 0' } });
  nx.pages.push(p2);

  const p3: NxPage = { id: 3, name: 'qr', bco: C.WHITE, components: [] };
  comp(p3, 'text', 'tTitle', 0, 0, 320, 24, { txt: 'Scan for the web dashboard', bco: C.TEAL, pco: C.WHITE, font: 1 });
  comp(p3, 'qr', 'qr0', 90, 34, 140, 140, { txt: dashboardUrl, bco: C.WHITE, pco: C.BLACK });
  comp(p3, 'text', 'tUrl', 0, 178, 320, 22, { txt: dashboardUrl, bco: C.WHITE, pco: C.BLACK, font: 0 });
  comp(p3, 'button', 'bBack', 8, 208, 100, 30, { txt: '< Back', bco: C.PANEL, pco: C.WHITE, bco2: C.TEAL, pco2: C.WHITE, font: 1 }, { press: { sendId: true, code: '' }, release: { sendId: false, code: 'page 0' } });
  nx.pages.push(p3);
  return nx;
}

/** Small layout for the first Nextion lessons. */
export function simpleNextion(): NextionProject {
  const nx = emptyNextionProject();
  const p = nx.pages[0];
  p.bco = C.DARK;
  comp(p, 'text', 't0', 10, 10, 300, 40, { txt: 'Waiting for Pi...', bco: C.PANEL, pco: C.WHITE, font: 2 });
  comp(p, 'number', 'n0', 10, 60, 140, 40, { val: 0, bco: C.PANEL, pco: C.GREEN, font: 3 });
  comp(p, 'progress', 'j0', 160, 66, 150, 28, { val: 0, bco: C.PANEL, pco: C.BLUE });
  comp(p, 'button', 'b0', 10, 120, 145, 60, { txt: 'PUMP ON', bco: C.GREEN, pco: C.BLACK, bco2: C.TEAL, pco2: C.WHITE, font: 2 }, { press: { sendId: true, code: '' } });
  comp(p, 'button', 'b1', 165, 120, 145, 60, { txt: 'PUMP OFF', bco: C.RED, pco: C.WHITE, bco2: C.TEAL, pco2: C.WHITE, font: 2 }, { press: { sendId: true, code: '' } });
  comp(p, 'text', 't1', 10, 196, 300, 34, { txt: 'Pump: OFF', bco: C.DARK, pco: C.YELLOW, font: 2 });
  return nx;
}

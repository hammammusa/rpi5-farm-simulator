import { beforeEach, describe, expect, it } from 'vitest';
import { autoRoute, expandWire, findCrossings, insertBend, removeBend, simplify } from '../../src/engine/routing';
import { CircuitBuilder, newProject } from '../../src/engine/project';
import { buildNetlist } from '../../src/engine/netlist';
import { migrate } from '../../src/state/persist';
import { compBounds, pinPosition, useApp } from '../../src/state/store';

const pt = (x: number, y: number) => ({ x, y });

describe('wire routing geometry', () => {
  it('manual route draws straight segments through the bend points', () => {
    const p = expandWire(pt(0, 0), [pt(50, 0), pt(50, 40)], pt(100, 40), 'manual');
    expect(p.pts).toEqual([pt(0, 0), pt(50, 0), pt(50, 40), pt(100, 40)]);
    expect(p.gap).toEqual([0, 1, 2]);
  });

  it('orthogonal route only produces horizontal/vertical segments', () => {
    const p = expandWire(pt(0, 0), [pt(60, 30)], pt(100, 90), 'orthogonal');
    for (let i = 0; i + 1 < p.pts.length; i++) {
      const a = p.pts[i];
      const b = p.pts[i + 1];
      expect(a.x === b.x || a.y === b.y).toBe(true);
    }
    expect(p.pts[0]).toEqual(pt(0, 0));
    expect(p.pts[p.pts.length - 1]).toEqual(pt(100, 90));
  });

  it('45° route uses only axis-aligned or exactly diagonal segments', () => {
    const p = expandWire(pt(0, 0), [], pt(100, 40), 'diag45');
    for (let i = 0; i + 1 < p.pts.length; i++) {
      const dx = Math.abs(p.pts[i + 1].x - p.pts[i].x);
      const dy = Math.abs(p.pts[i + 1].y - p.pts[i].y);
      expect(dx === 0 || dy === 0 || Math.abs(dx - dy) < 1e-9).toBe(true);
    }
  });

  it('straight route ignores bend points', () => {
    expect(expandWire(pt(0, 0), [pt(5, 50)], pt(10, 0), 'straight').pts).toHaveLength(2);
  });

  it('inserts a bend into the nearest segment and removes the nearest bend', () => {
    const pts = insertBend(pt(0, 0), [pt(100, 0)], pt(100, 100), 'manual', pt(102, 60));
    expect(pts).toEqual([pt(100, 0), pt(102, 60)]);
    const pts2 = insertBend(pt(0, 0), [pt(100, 0)], pt(100, 100), 'manual', pt(40, 3));
    expect(pts2).toEqual([pt(40, 3), pt(100, 0)]);
    expect(removeBend(pts2, pt(99, 1))).toEqual([pt(40, 3)]);
    expect(removeBend(pts2, pt(0, 0), 0)).toEqual([pt(100, 0)]);
  });

  it('simplify drops collinear points', () => {
    expect(simplify([pt(0, 0), pt(10, 0), pt(20, 0), pt(20, 10)])).toEqual([pt(0, 0), pt(20, 0), pt(20, 10)]);
  });

  it('auto-route goes around a component body', () => {
    const block = { x0: 40, y0: -40, x1: 160, y1: 40 };
    const bends = autoRoute(pt(0, 0), pt(200, 0), [block]);
    const path = [pt(0, 0), ...bends, pt(200, 0)];
    // orthogonal
    for (let i = 0; i + 1 < path.length; i++) expect(path[i].x === path[i + 1].x || path[i].y === path[i + 1].y).toBe(true);
    // no segment passes through the block interior
    for (let i = 0; i + 1 < path.length; i++) {
      const a = path[i];
      const b = path[i + 1];
      for (let s = 0; s <= 20; s++) {
        const x = a.x + ((b.x - a.x) * s) / 20;
        const y = a.y + ((b.y - a.y) * s) / 20;
        expect(x > block.x0 && x < block.x1 && y > block.y0 && y < block.y1).toBe(false);
      }
    }
  });

  it('finds visual crossings', () => {
    const c = findCrossings([
      { id: 'a', pts: [pt(0, 50), pt(100, 50)] },
      { id: 'b', pts: [pt(50, 0), pt(50, 100)] },
      { id: 'c', pts: [pt(0, 200), pt(100, 200)] },
    ]);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ x: 50, y: 50, a: 'a', b: 'b' });
  });
});

describe('crossing wires are not electrically connected (D9)', () => {
  it('two crossing wires keep separate nets', () => {
    const doc = new CircuitBuilder()
      .add('pi', 'rpi5', 0, 0)
      .add('r1', 'resistor', 100, 400)
      .add('r2', 'resistor', 300, 400)
      .wire('pi.P11', 'r2.1')
      .wire('pi.P12', 'r1.1')
      .doc();
    // make the two wires cross visually
    doc.wires[0].points = [{ x: 140, y: 200 }];
    doc.wires[1].points = [{ x: 330, y: 200 }];
    const net = buildNetlist(doc);
    expect(net.netOf({ comp: 'r1', pin: '1' })).not.toBe(net.netOf({ comp: 'r2', pin: '1' }));
  });
});

describe('store: wire editing and part tools', () => {
  beforeEach(() => {
    const doc = new CircuitBuilder()
      .add('pi', 'rpi5', 0, 0)
      .add('r1', 'resistor', 400, 300)
      .add('led1', 'led', 500, 300)
      .add('led2', 'led', 600, 360)
      .wire('pi.P11', 'r1.1')
      .wire('r1.2', 'led1.A')
      .wire('led1.K', 'pi.P6')
      .doc();
    useApp.getState().loadProject(doc);
  });
  const st = () => useApp.getState();
  const wire = (i: number) => st().doc.wires[i];

  it('changes colour (palette or custom hex) and thickness', () => {
    st().updateWire(wire(0).id, { color: '#8b5a2b' });
    st().updateWire(wire(0).id, { width: 5 });
    expect(wire(0)).toMatchObject({ color: '#8b5a2b', width: 5 });
  });

  it('adds, moves and removes bend points; undo restores', () => {
    const id = wire(0).id;
    st().addBend(id, { x: 200, y: 200 });
    expect(wire(0).points).toEqual([{ x: 200, y: 200 }]);
    st().updateWire(id, { points: [{ x: 220, y: 210 }] });
    expect(wire(0).points).toEqual([{ x: 220, y: 210 }]);
    st().removeBendAt(id, { x: 221, y: 211 });
    expect(wire(0).points).toBeUndefined();
    st().undo();
    expect(wire(0).points).toEqual([{ x: 220, y: 210 }]);
  });

  it('auto-routes a wire orthogonally', () => {
    expect(st().autoRouteWire(wire(0).id)).toBe(true);
    expect(wire(0).route).toBe('orthogonal');
  });

  it('moving a part keeps its wires attached (end follows the pin)', () => {
    const before = pinPosition(st().doc, { comp: 'r1', pin: '1' })!;
    st().moveComponents(['r1'], 50, 20, true);
    const after = pinPosition(st().doc, { comp: 'r1', pin: '1' })!;
    expect(after).toEqual({ x: before.x + 50, y: before.y + 20 });
    expect(wire(0).to).toEqual({ comp: 'r1', pin: '1' });
  });

  it('locked parts do not move', () => {
    st().select(['led1']);
    st().toggleLock();
    st().moveComponents(['led1'], 30, 0, true);
    expect(st().doc.components.find((c) => c.id === 'led1')!.x).toBe(500);
  });

  it('copy/paste duplicates parts and the wires between them', () => {
    st().select(['r1', 'led1']);
    expect(st().copySelection()).toBe(2);
    st().paste();
    expect(st().doc.components).toHaveLength(6);
    expect(st().doc.wires).toHaveLength(4);
  });

  it('groups, aligns and distributes', () => {
    st().select(['r1', 'led1', 'led2']);
    st().groupSelected();
    const g = st().doc.components.find((c) => c.id === 'r1')!.group;
    expect(g).toBeTruthy();
    expect(st().doc.components.filter((c) => c.group === g)).toHaveLength(3);
    st().align('top');
    const tops = ['r1', 'led1', 'led2'].map((id) => compBounds(st().doc.components.find((c) => c.id === id)!).y0);
    expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(10);
    st().distribute('h');
    st().ungroupSelected();
    expect(st().doc.components.find((c) => c.id === 'r1')!.group).toBeUndefined();
  });

  it('saves view settings in the document', () => {
    st().setView({ background: '#ffffff', showGpioNumbers: true, gridSize: 20 });
    expect(st().doc.view).toMatchObject({ background: '#ffffff', showGpioNumbers: true, gridSize: 20 });
  });
});

describe('project format migration (G5)', () => {
  it('upgrades a schema-1 project without losing parts, wires or code', () => {
    const old = {
      schema: 1,
      id: 'p_old',
      name: 'Old project',
      components: [
        { id: 'pi', type: 'rpi5', x: 40, y: 60, rotation: 0, props: {} },
        { id: 'led1', type: 'led', x: 400, y: 300, rotation: 90, props: { color: 'green' } },
      ],
      wires: [{ id: 'w1', from: { comp: 'pi', pin: 'P11' }, to: { comp: 'led1', pin: 'A' }, color: '#e0393e', points: [{ x: 100, y: 200 }] }],
      files: [{ name: 'main.py', content: 'print(1)' }],
      mainFile: 'main.py',
    };
    const d = migrate(old);
    expect(d.schema).toBe(2);
    expect(d.components).toHaveLength(2);
    expect(d.components[1]).toMatchObject({ rotation: 90, props: { color: 'green' } });
    expect(d.wires[0]).toMatchObject({ color: '#e0393e', points: [{ x: 100, y: 200 }] });
    expect(d.wires[0].route ?? 'manual').toBe('manual');
    expect(d.files[0].content).toBe('print(1)');
    expect(d.view?.snap).toBe(true);
  });

  it('new projects use the current schema', () => {
    expect(newProject().schema).toBe(2);
  });
});

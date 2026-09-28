// Main menu shown over a live, slowly orbiting preview of the generated map.
export interface MenuOptions {
  seed: number;
  size: number;
  players: number;
  ai: number;
}

export function showMenu(parent: HTMLElement, opts: MenuOptions, onStart: () => void, onRegenerate: (o: MenuOptions) => void, onOptions?: () => void) {
  const el = document.createElement('div');
  el.className = 'menu';
  el.innerHTML = `
    <div class="menu-inner">
      <div class="title">
        <div class="crest">⚜</div>
        <h1>Terra Nova</h1>
        <div class="sub">A tribute to <i>The Settlers III</i></div>
      </div>
      <div class="panel menu-card">
        <div class="field"><label>Map size</label>
          <div class="seg" data-k="size">
            <button data-v="128">Small</button><button data-v="160">Medium</button><button data-v="208">Large</button>
          </div></div>
        <div class="field"><label>Opponents</label>
          <div class="seg" data-k="players">
            <button data-v="2">1</button><button data-v="3">2</button><button data-v="4">3</button>
          </div></div>
        <div class="field"><label>AI difficulty</label>
          <div class="seg" data-k="ai">
            <button data-v="0">Easy</button><button data-v="1">Normal</button><button data-v="2">Hard</button>
          </div></div>
        <div class="field"><label>World seed</label>
          <div class="seedrow"><input type="number" value="${opts.seed}" id="seed"><button id="dice" title="Random world">🎲</button></div></div>
        <button class="wide primary big" id="start">Found your settlement</button>
        <div class="row"><button class="wide" id="help">How to play</button><button class="wide" id="options">Options</button></div>
      </div>
      <div class="menu-foot">All graphics and most sounds are generated procedurally in your browser.</div>
    </div>
    <div class="panel help hidden" id="helpbox">
      <h2>How to play</h2>
      <p>Grow a thriving economy, expand your borders and conquer your rivals — just like the classic.</p>
      <ol>
        <li><b>Wood & stone first.</b> Build Woodcutters near forests, a Forester to replant, a Sawmill to turn logs into boards, and a Stonecutter next to rocks.</li>
        <li><b>Settlers carry everything.</b> There are no roads — carriers walk goods between buildings. Build Residences to grow your population.</li>
        <li><b>Expand.</b> Guard towers, Watchtowers and Castles claim land once a soldier moves in. Pioneers (Military tab) stake out free land beside your border with nothing but a shovel — though an enemy stronghold's borders take it back.</li>
        <li><b>Feed the mines.</b> Fishers, Hunters and Bakeries (Farm → Windmill → Bakery + Waterworks) supply food for mines on the mountains. Send a Geologist (Industry tab) to your mountains: his signs and the glittering specks he uncovers reveal coal, iron and gold.</li>
        <li><b>Arm yourself.</b> Iron Smelter + Coal → Iron → Weaponsmith → swords & bows → Barracks trains soldiers. Gold in storage raises morale.</li>
        <li><b>Take to the sea.</b> A Harbour and a Shipyard on the coast give you ships. They carry goods and settlers between your harbours, and a harbour can send an expedition to found a colony on the rich islands offshore.</li>
        <li><b>Conquer.</b> Select an enemy military building in reach and press Attack. Capture them all to win.</li>
      </ol>
      <p class="muted">Controls: WASD / arrows or right-drag to scroll, mouse wheel to zoom, Q/E to rotate, Space to pause.</p>
      <button class="wide" id="helpclose">Got it</button>
    </div>`;
  parent.appendChild(el);
  const cur = { ...opts };
  el.querySelectorAll<HTMLElement>('.seg').forEach((seg) => {
    const k = seg.dataset.k as keyof MenuOptions;
    seg.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
      if (Number(b.dataset.v) === cur[k]) b.classList.add('on');
      b.onclick = () => {
        cur[k] = Number(b.dataset.v);
        seg.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        if (k === 'size' || k === 'players') onRegenerate(cur);
      };
    });
  });
  const seedIn = el.querySelector<HTMLInputElement>('#seed')!;
  seedIn.onchange = () => { cur.seed = Number(seedIn.value) || 1; onRegenerate(cur); };
  el.querySelector<HTMLButtonElement>('#dice')!.onclick = () => { cur.seed = Math.floor(Math.random() * 99999) + 1; onRegenerate(cur); };
  el.querySelector<HTMLButtonElement>('#start')!.onclick = () => {
    opts.ai = cur.ai;
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 700);
    onStart();
  };
  const help = el.querySelector<HTMLElement>('#helpbox')!;
  el.querySelector<HTMLButtonElement>('#help')!.onclick = () => help.classList.remove('hidden');
  el.querySelector<HTMLButtonElement>('#helpclose')!.onclick = () => help.classList.add('hidden');
  el.querySelector<HTMLButtonElement>('#options')!.onclick = () => onOptions?.();
  return { el, cur };
}

export function showLoading(parent: HTMLElement, text: string) {
  const el = document.createElement('div');
  el.className = 'loading';
  el.innerHTML = `<div class="crest spin">⚜</div><div>${text}</div>`;
  parent.appendChild(el);
  return el;
}

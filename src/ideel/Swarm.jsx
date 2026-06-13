import { useEffect, useRef } from 'react'
import * as THREE from 'three'

/* ───────────────────── Partikelfjärilen: planschens högra blad ─────────────────────
   En tät, fjärilsformad punktsvärm i three.js (WebGL) med föreningens streckade neonhjärta i mitten.

   Form: Temple Fay-kurvan ("the butterfly curve") sveps över hela parameterintervallet och varje punkt
   sprids kring kurvan med gaussiskt brus i xyz, så vingarna fylls som en luftig, tredimensionell
   datavolym i stället för en platt kontur.

   Interaktion: muspekaren styr (1) en mjuk lutning av hela svärmen (parallax) och (2) en VIRVEL I
   Z-LED i vertexshadern: djuplagren vrids olika mycket kring mitten (vridningen är proportionell mot
   varje partikels z), så volymen "skruvar sig" levande efter musen MEN behåller fjärilssiluetten,
   eftersom alla förskjutningar är begränsade och utgår från fasta baspositioner.

   Hänsyn: prefers-reduced-motion ritar en stillbild (ingen RAF-loop), fliken i bakgrunden eller
   scenen utanför viewporten pausar loopen, devicePixelRatio är kapad till 2 och allt städas vid
   unmount (geometri, material, renderer). Inga inline-script: CSP-kompatibelt via Vite-bundeln. */

const COUNT = 9000

// Enhetlig rosa familj (samma kulörer som CSS-variablerna): djup ros -> neonros, plus enstaka
// nästan vita gnistor. Mörkare punkter mot ljus botten läses som planschens "tryckta" prickar.
const DEEP = new THREE.Color('#b3255f')
const NEON = new THREE.Color('#ff5fa2')
const SPARK = new THREE.Color('#ffc7e0')

// Temple Fay: x = sin t * E, y = cos t * E, E = e^cos t - 2cos 4t - sin^5(t/12), t i [0, 12pi].
function butterflyXY(t) {
  const E = Math.exp(Math.cos(t)) - 2 * Math.cos(4 * t) - Math.pow(Math.sin(t / 12), 5)
  return [Math.sin(t) * E, Math.cos(t) * E]
}

// Box-Muller: gaussiskt brus för volymens tjocklek (jämnt slumptal ger hård, onaturlig kant).
function gauss() {
  let u = 0, v = 0
  while (u === 0) u = Math.random()
  while (v === 0) v = Math.random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

function buildGeometry() {
  const pos = new Float32Array(COUNT * 3)
  const seed = new Float32Array(COUNT)
  const size = new Float32Array(COUNT)
  const tone = new Float32Array(COUNT)
  let i = 0
  while (i < COUNT) {
    const t = Math.random() * Math.PI * 12
    const [bx, by] = butterflyXY(t)
    // Kurvan passerar mitten många gånger: utan gallring blir kroppen en kompakt klump som
    // skymmer hjärtlogotypen (värst på mobil där scenen är smal). Punkter nära centrum
    // behålls därför bara ibland, så logotypen får ett lugnt fönster i alla storlekar.
    const r = Math.hypot(bx, by)
    if (r < 1.6 && Math.random() > 0.25) continue
    // 7 % "strön": lösare spridda punkter som ger det dammiga, levande molnet runt konturen.
    const stray = Math.random() < 0.07
    const s = stray ? 0.6 : 0.16
    pos[i * 3] = bx * 1.12 + gauss() * s          // 1.12: något bredare vingspann
    pos[i * 3 + 1] = by + gauss() * s
    pos[i * 3 + 2] = gauss() * (stray ? 0.9 : 0.5) // volymens tjocklek i djupled
    seed[i] = Math.random()
    const sparkle = Math.random() > 0.985
    size[i] = sparkle ? 3.8 : 1.1 + Math.random() * 2.0
    tone[i] = sparkle ? 1 : Math.random() * 0.9
    i++
  }
  // Recentrera och normalisera: kurvans tyngdpunkt ligger över origo (vingarna pekar uppåt),
  // så svärmen flyttas till sin mittpunkt och skalas till känd halvbredd. Då kan kameran
  // passas exakt mot formen och hjärtat hamnar mitt i volymen.
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9
  for (let j = 0; j < COUNT; j++) {
    const x = pos[j * 3], y = pos[j * 3 + 1]
    if (x < minX) minX = x; if (x > maxX) maxX = x
    if (y < minY) minY = y; if (y > maxY) maxY = y
  }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2
  const halfW = 5.0
  const k = halfW / ((maxX - minX) / 2)
  for (let j = 0; j < COUNT; j++) {
    pos[j * 3] = (pos[j * 3] - cx) * k
    pos[j * 3 + 1] = (pos[j * 3 + 1] - cy) * k
    pos[j * 3 + 2] *= k
  }
  const halfH = ((maxY - minY) / 2) * k
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1))
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1))
  g.setAttribute('aTone', new THREE.BufferAttribute(tone, 1))
  return { geometry: g, halfW, halfH }
}

const VERT = /* glsl */ `
  attribute float aSeed;
  attribute float aSize;
  attribute float aTone;
  uniform float uTime;
  uniform float uTwist;
  uniform float uPixelRatio;
  varying float vTone;
  varying float vSeed;

  void main() {
    vTone = aTone;
    vSeed = aSeed;
    vec3 p = position;

    // Andning: små, begränsade sinusdrifter per partikel håller volymen levande utan att lösa upp formen.
    float ph = aSeed * 6.2831;
    p.x += sin(uTime * 0.62 + ph * 7.0) * 0.05;
    p.y += cos(uTime * 0.51 + ph * 3.0) * 0.05;
    p.z += sin(uTime * 0.43 + ph * 5.0) * 0.08;

    // Vingslag: ytterkanterna vajar mjukt i djupled, mest längst ut på vingen.
    p.z += sin(uTime * 0.8 + ph) * abs(position.x) * 0.05;

    // Virveln i Z-led (musstyrd): varje djuplager vrids kring mitten proportionellt mot sitt z,
    // så svärmen skruvar sig som en levande volym men återvänder alltid till fjärilsformen.
    // Koefficienterna är medvetet låga: med pekaren parkerad i ena kanten ska silhuetten
    // fortfarande läsas som en fjäril, inte smetas ut till en rund sky.
    float a = uTwist * (p.z * 0.45 + 0.25 * sin(ph + uTime * 0.22));
    float ca = cos(a), sa = sin(a);
    p.xy = mat2(ca, -sa, sa, ca) * p.xy;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uPixelRatio * (30.0 / -mv.z);
  }
`

const FRAG = /* glsl */ `
  precision mediump float;
  uniform vec3 uDeep;
  uniform vec3 uNeon;
  uniform vec3 uSpark;
  varying float vTone;
  varying float vSeed;

  void main() {
    // Mjuk rund punkt: alfa faller från kärnan mot kanten (inga fyrkantiga sprites).
    // Omvända smoothstep-kanter (edge0 > edge1) är odefinierat i GLSL ES: därför 1.0 - smoothstep.
    float d = length(gl_PointCoord - 0.5);
    float alpha = 1.0 - smoothstep(0.12, 0.5, d);
    if (alpha < 0.02) discard;
    vec3 col = vTone > 0.95 ? uSpark : mix(uDeep, uNeon, smoothstep(0.0, 0.9, vTone));
    gl_FragColor = vec4(col, alpha * (0.55 + 0.45 * vSeed));
    // three r152+ lagrar THREE.Color linjärt (ColorManagement på): konvertera tillbaka till
    // sRGB-utdata, annars ritas svärmen i en rödare rosa än CSS-palettens #ff5fa2.
    #include <colorspace_fragment>
  }
`

export default function Swarm() {
  const hostRef = useRef(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const coarse = window.matchMedia('(hover: none)').matches

    // antialias av: MSAA gör inget för punkt-sprites (kanten mjukas redan i fragmentshadern)
    // och kostar bara fillrate på en 46 % x 100dvh-yta.
    const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true })
    renderer.setClearColor(0x000000, 0)
    host.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100)

    const { geometry, halfW, halfH } = buildGeometry()
    const material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      uniforms: {
        uTime: { value: 0 },
        uTwist: { value: 0 },
        uPixelRatio: { value: 1 },   // sätts av fit(): läses om vid varje resize/skärmbyte
        uDeep: { value: DEEP },
        uNeon: { value: NEON },
        uSpark: { value: SPARK },
      },
    })
    const points = new THREE.Points(geometry, material)
    // Liten grundlutning så volymen läses som tredimensionell redan innan musen rör sig.
    const BASE_TILT = { x: -0.14, z: 0.06 }
    points.rotation.set(BASE_TILT.x, 0, BASE_TILT.z)
    scene.add(points)

    // Kameran backas så att svärmen (uppmätt halvbredd/halvhöjd) fyller ca 86 % av scenen,
    // oavsett bladets proportioner (fast högerblad på desktop, brett toppblad på mobil).
    function fit() {
      // devicePixelRatio läses om varje gång: fönstret kan dras mellan 1x- och 2x-skärmar.
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      renderer.setPixelRatio(dpr)
      material.uniforms.uPixelRatio.value = dpr
      const w = host.clientWidth || 1
      const h = host.clientHeight || 1
      camera.aspect = w / h
      const tanHalf = Math.tan((camera.fov * Math.PI) / 360)
      const distW = halfW / (tanHalf * camera.aspect * 0.86)
      const distH = halfH / (tanHalf * 0.86)
      camera.position.z = Math.max(distW, distH)
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
    }
    fit()

    // Musen normaliseras till [-1, 1] över hela fönstret: även text-sidan styr svärmen,
    // så planschen känns som EN sammanhängande yta. Pekskärm utan hover: mjuk autopilot.
    const mouse = { x: 0, y: 0 }
    function onPointerMove(e) {
      mouse.x = (e.clientX / window.innerWidth) * 2 - 1
      mouse.y = (e.clientY / window.innerHeight) * 2 - 1
    }
    if (!reduced && !coarse) window.addEventListener('pointermove', onPointerMove, { passive: true })

    let raf = 0
    let running = false
    let visible = true
    let hidden = document.hidden
    let last = 0
    let time = 0

    function frame(now) {
      raf = 0
      const dt = Math.min((now - last) / 1000 || 0, 0.05)
      last = now
      time += dt
      if (coarse) {
        // Autopilot: en långsam vandring som visar volymeffekten även utan pekare.
        mouse.x = Math.sin(time * 0.13) * 0.6
        mouse.y = Math.cos(time * 0.09) * 0.35
      }
      // Dämpad styrning: lutning (parallax) och virvel glider mot sina mål i stället för att rycka.
      // Faktorn härleds ur dt (exponentiell glidning) så känslan är densamma på 60 som 144 Hz.
      const k = 1 - Math.exp(-2.8 * dt)
      points.rotation.y += (mouse.x * 0.28 - points.rotation.y) * k
      points.rotation.x += (BASE_TILT.x - mouse.y * 0.30 - points.rotation.x) * k
      material.uniforms.uTime.value = time
      material.uniforms.uTwist.value += (mouse.x * 0.4 - material.uniforms.uTwist.value) * (1 - Math.exp(-2.4 * dt))
      renderer.render(scene, camera)
      if (running) raf = requestAnimationFrame(frame)
    }
    function setRunning(next) {
      const want = next && !reduced
      if (want === running) return
      running = want
      if (running) { last = performance.now(); raf = requestAnimationFrame(frame) }
      else if (raf) { cancelAnimationFrame(raf); raf = 0 }
    }

    // Stillbild för prefers-reduced-motion, annars loop som pausar när fliken/scenen inte syns.
    renderer.render(scene, camera)
    const io = new IntersectionObserver((entries) => {
      // Flera köade poster kan levereras i samma anrop (snabb scroll ut och in på mobil):
      // läs den SENASTE, annars kan flaggan fastna i ett gammalt läge och svärmen frysa.
      const rec = entries[entries.length - 1]
      visible = rec ? rec.isIntersecting : true
      setRunning(visible && !hidden)
    })
    io.observe(host)
    function onVisibility() {
      hidden = document.hidden
      setRunning(visible && !hidden)
    }
    document.addEventListener('visibilitychange', onVisibility)

    // Förlorad WebGL-kontext (GPU-reset, flikdvala): stoppa loopen i stället för att rita mot en
    // död kontext, och återuppta när webbläsaren återställt den.
    function onCtxLost(e) { e.preventDefault(); setRunning(false) }
    function onCtxRestored() { fit(); setRunning(visible && !hidden) }
    renderer.domElement.addEventListener('webglcontextlost', onCtxLost)
    renderer.domElement.addEventListener('webglcontextrestored', onCtxRestored)

    const ro = new ResizeObserver(() => {
      fit()
      if (!running) renderer.render(scene, camera)
    })
    ro.observe(host)
    // ResizeObserver triggas inte alltid när fönstret dras till en skärm med annan pixeltäthet
    // utan att elementets CSS-mått ändras: fånga det via window-resize också.
    window.addEventListener('resize', fit)

    return () => {
      setRunning(false)
      io.disconnect()
      ro.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('resize', fit)
      renderer.domElement.removeEventListener('webglcontextlost', onCtxLost)
      renderer.domElement.removeEventListener('webglcontextrestored', onCtxRestored)
      geometry.dispose()
      material.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [])

  return (
    <div ref={hostRef} aria-hidden="true" style={{ position: 'absolute', inset: 0 }} />
  )
}

// Testi dei pannelli che si aprono con E. BOZZE: da correggere dall'autore.

const IMG = import.meta.env.BASE_URL + 'nandor/';

export const PANELS = {
  // contatti: i link si cliccano, quindi all'apertura il mouse viene liberato (interact.js)
  contatti: {
    title: { it: 'Contatti', en: 'Contacts' },
    links: true,
    body: [
      { it: 'Email', en: 'Email', href: 'mailto:ferdinandosmaldone89@gmail.com', text: 'ferdinandosmaldone89@gmail.com' },
      { it: 'Thunderstore', en: 'Thunderstore', href: 'https://thunderstore.io/c/valheim/p/Nandor/', text: 'thunderstore.io/c/valheim/p/Nandor' },
    ],
  },
  nandor: {
    title: { it: 'Nandor: come è nato il suo volto', en: 'Nandor: how his face was made' },
    image: IMG + 'photo-left.jpg',
    caption: {
      it: 'La scansione grezza di 3D Snap con le sue texture originali, vista dalla guancia sinistra: il lato riuscito.',
      en: 'The raw 3D Snap scan with its original textures, seen from the left cheek: the side that came out right.',
    },
    body: [
      {
        it: 'Il volto dell\'ologramma è un volto vero: il mio. L\'ho scansionato con 3D Snap, un\'app per iPhone che trasforma una ripresa del viso in un modello 3D. Ne è uscito un file OBJ di circa cinquemila vertici con tre texture: colore, normali e occlusione.',
        en: 'The face in the hologram is a real face: mine. I scanned it with 3D Snap, an iPhone app that turns a capture of a face into a 3D model. The result was an OBJ file of about five thousand vertices with three textures: colour, normals and occlusion.',
      },
      {
        it: 'La scansione non è perfetta: la metà destra del viso è uscita deformata, la sinistra è fedele. La foto mostra il modello così come l\'ha consegnato l\'app, dal lato buono.',
        en: 'The scan is not perfect: the right half of the face came out distorted, the left half is faithful. The photo shows the model exactly as the app delivered it, from the good side.',
      },
      {
        it: 'Il modello arrivava anche storto, girato di una quarantina di gradi. Abbiamo segnato a mano occhi, naso, bocca e mento sulla mesh e da quei punti abbiamo ricavato gli assi per raddrizzarlo.',
        en: 'The model also arrived crooked, turned by about forty degrees. We marked the eyes, nose, mouth and chin on the mesh by hand and derived the axes to straighten it from those points.',
      },
      {
        it: 'Poi lo shader, in GLSL con three.js: la luminosità della foto diventa una scala di verdi, le normali della scansione danno il rilievo, i bordi si sfaldano in circuiti e particelle, gli occhi si accendono, e ogni tanto un glitch a fasce lo attraversa.',
        en: 'Then the shader, in GLSL with three.js: the brightness of the photo becomes a ramp of greens, the scan\'s normals give it relief, the edges crumble into circuits and particles, the eyes light up, and now and then a banded glitch runs through it.',
      },
      {
        it: 'Nella sua pagina originale Nandor parla: la bocca si deforma sillaba per sillaba, a tempo con la sintesi vocale del browser. Qui nel museo, per ora, osserva chi entra.',
        en: 'On his original page Nandor talks: the mouth deforms syllable by syllable, in time with the browser\'s speech synthesis. Here in the museum, for now, he watches whoever walks in.',
      },
    ],
  },
};

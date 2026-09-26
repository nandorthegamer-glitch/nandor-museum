// File delle stanze: rooms/<id>/media/*. Vite li include nella build da solo; qui si
// trasforma "media/xxx" di un room.json nell'URL vero.

const urls = import.meta.glob('../rooms/*/media/*', { eager: true, query: '?url', import: 'default' });

export function mediaUrl(roomId, rel) {
  const url = urls[`../rooms/${roomId}/${rel}`];
  if (!url) console.warn('file mancante:', roomId, rel);
  return url;
}

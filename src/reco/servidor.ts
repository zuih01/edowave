/**
 * Lo que el SERVIDOR usa del algoritmo: el mismo código que tenía la app, sin cambios, empaquetado para Node
 * (ver scripts/motor-servidor.mjs → servidor/src/reco/motor.js). Así el feed, la radio y el buscador son
 * iguales en todos los aparatos: los calcula el servidor con los datos de tu cuenta.
 *
 * Solo módulos puros (sin pantalla, sin almacenamiento del navegador).
 */
export {
  billboardIds,
  buildModel,
  descubrimientoSemanal,
  groupScore,
  heardIds,
  MIN_HEARD,
  mixesDiarios,
  mixesParaTi,
  paraTi,
  moodMix,
  MOODS,
  radio,
  radioChain,
  rediscover,
  shortcuts,
  shufflePool,
} from './engine';
export { buscarTodo } from './buscar';
export { clasificarEscenas } from './escenas';
export { interpretarBusqueda, listaDeBusqueda } from './consulta';
export { groupLibrary } from '../library/group';
export { marcarExitos, matchChart } from '../library/chart';

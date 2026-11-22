// Shared allowlist: clients and server offer exactly the same sticker collection.
export const REACTIONS = Object.freeze([
  ['laugh','Laugh'],['shocked','Shocked'],['fire','On fire'],['lightning','Zap'],
  ['skull','Dead laughing'],['cry','Crying'],['love','Love it'],['cool','Too cool'],
  ['wink','Wink'],['party','Party time'],['angry','No way!'],['clap','Applause'],
  ['heart','Big heart'],['rose','A rose'],['bomb','Boom'],['trophy','Champion'],
  ['coffee','Coffee break'],['wave','Hello'],['gg','Good game'],['kiss','Flying kiss'],
].map(([id,label])=>Object.freeze({id,label})));

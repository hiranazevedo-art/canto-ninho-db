import {json} from '../../_security.js';

// The account API is served exclusively from /api/account.
export function onRequest(){
 return json({error:'Rota inválida.'},404);
}

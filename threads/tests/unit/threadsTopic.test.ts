import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareThreadsPost} from '../../src/shared/threadsTopic.js';
test('Threads: ни хештегов в тексте, ни темы — хвост из тегов снимается целиком',()=>{
  assert.deepEqual(prepareThreadsPost('Про рынок. #биткоин #крипта'),{text:'Про рынок.'});
  assert.deepEqual(prepareThreadsPost('О стейблкоинах без хештега.'),{text:'О стейблкоинах без хештега.'});
  assert.deepEqual(prepareThreadsPost('кот смотрит как налоговая\n\n#Жиза'),{text:'кот смотрит как налоговая'});
  assert.equal(prepareThreadsPost('Читаю #биткоин сегодня.').text,'Читаю биткоин сегодня.');
  assert.equal(prepareThreadsPost('Ссылка https://example.com/#section').text,'Ссылка https://example.com/#section');
  assert.deepEqual(prepareThreadsPost('Просто разговор.'),{text:'Просто разговор.'});
});

test('Threads normalizes long dashes and preserves URL paths',()=>{
  assert.equal(prepareThreadsPost('Крипто — рынок – риск. 10−2 https://example.com/а—б').text, 'Крипто - рынок - риск. 10−2 https://example.com/а—б');
});

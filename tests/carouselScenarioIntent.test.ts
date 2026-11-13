import {test} from "node:test";import assert from "node:assert/strict";
import {parseScenarioReview,SCENARIO_RULES} from "../lib/carousel/scenarioIntent";
import {paintedStoryProblems} from "../lib/carousel/storyDirection";
test("a causal claim about ETH is not a boilerplate financial disclaimer",()=>{
  const draft:any={caption:"Рост сети не гарантирует рост ETH: комиссии могут снижаться.",slides:[{kind:"cover",title:"Рост сети не гарантирует рост ETH",body:"",bullets:[],cta:"",kicker:""}]};
  assert.ok(!paintedStoryProblems(draft,{artworkMode:"painted"}).some(x=>/дисклеймер/.test(x)));
  draft.caption="Это не финансовый совет";
  assert.ok(paintedStoryProblems(draft,{artworkMode:"painted"}).some(x=>/дисклеймер/.test(x)));
});
test("a semantic failure remains actionable, not a warning",()=>{assert.deepEqual(parseScenarioReview({ok:false,issues:["Карточка 2: урок о цене вместо функций CoinGecko"]}),["Карточка 2: урок о цене вместо функций CoinGecko"]);});
test("invalid or contradictory reviewer output cannot authorize drawing",()=>{for(const value of [null,{}, {ok:true,issues:["wrong"]},{ok:false,issues:[]},{ok:true,issues:[null]}])assert.throws(()=>parseScenarioReview(value));assert.deepEqual(parseScenarioReview({ok:true,issues:[]}),[]);});
test("advice and instructions are not rejected just for imperative verbs",()=>{const draft:any={caption:"",slides:[{kind:"content",title:"Проверь адрес",body:"Сравни первые и последние символы перед переводом.",bullets:[],cta:"",kicker:"",image:{brief:"Hero compares two addresses"}}]};assert.ok(!paintedStoryProblems(draft,{artworkMode:"painted"} as any).some(x=>/задание зрителю/.test(x)));assert.match(SCENARIO_RULES,/Готовый сценарий/);assert.match(SCENARIO_RULES,/Последнее явное поручение/);});

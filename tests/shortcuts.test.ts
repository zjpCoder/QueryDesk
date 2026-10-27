import test from 'node:test';
import assert from 'node:assert/strict';
import { shortcut } from '../src/ui/shortcuts';

const key=(patch:Partial<KeyboardEvent>={}):KeyboardEvent=>({code:'Enter',ctrlKey:true,shiftKey:false,altKey:false,metaKey:false,repeat:false,isComposing:false,keyCode:13,getModifierState:()=>false,...patch}) as KeyboardEvent;
test('快捷键必须精确匹配修饰键，避免扩大执行范围',()=>{
  assert.equal(shortcut(key(),'Enter',true),true);
  for(const patch of [{shiftKey:true},{altKey:true},{metaKey:true},{ctrlKey:false},{code:'NumpadEnter'}])assert.equal(shortcut(key(patch),'Enter',true),false);
});
test('输入法组合输入、AltGr 和按键连发不执行快捷操作',()=>{
  for(const patch of [{isComposing:true},{keyCode:229},{repeat:true},{getModifierState:()=>true}])assert.equal(shortcut(key(patch),'Enter',true),false);
});

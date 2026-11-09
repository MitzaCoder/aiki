import {expect,test} from "bun:test";
import {decodeUiAttribute} from "./native-ui.ts";
test("fresh UI hierarchy preserves multiline/code clipboard text",()=>{
 expect(decodeUiAttribute("a&#10;b&#x9;c&#13;d")).toBe("a\nb\tc\rd");
 expect(decodeUiAttribute("&#x1f642;")).toBe("🙂");
});
test("UI attributes decode one XML layer, not escaped literal entities",()=>{
 expect(decodeUiAttribute("&quot;a&lt;b&gt;&apos;&amp;")).toBe('"a<b>\'&');
 expect(decodeUiAttribute("&amp;#10;&amp;quot;")).toBe("&#10;&quot;");
});

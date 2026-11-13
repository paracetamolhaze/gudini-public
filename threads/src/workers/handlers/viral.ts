import { registerHandler } from "../index.js";
import { scoutViral } from "../../services/viral/scout.js";
import { viralTick } from "../../services/viral/writer.js";

registerHandler("viral", "viral:scout", async () => scoutViral());
registerHandler("content", "viral:write", async () => viralTick());

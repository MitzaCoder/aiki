/** Bun-only, deterministic Kotlin DTO generation from the canonical TypeBox JSON Schema. */
import { BOARD_PREFIX, LEGACY_HARNESS_FEATURES, MAIN_THREAD_ID, MAX_REF_STATUS_REFS, TASK_REFERENCE_PREFIX, protocolJsonSchema } from "../../../packages/protocol/src/index.ts";

type Schema = Record<string, any>;
const defs = protocolJsonSchema().$defs as Record<string, Schema>;
const names = new Map<string, string>();
const unionNames = new Map<string, string>();
const output = new Map<string, string>();
const key = (s: Schema): string => JSON.stringify(s, (k, v) => ["description", "title", "examples", "default"].includes(k) ? undefined : v);
for (const [name, s] of Object.entries(defs)) if (s.type === "object" && s.properties) names.set(key(s), name);
/**
 * Required fields that a backend from before their feature leaves out, with what the app reads in their place, so a
 * board from a backend without `task-reports` still decodes instead of failing whole.
 */
const OLDER_BACKEND_DEFAULTS: Record<string, Record<string, string>> = {
    BoardTask: {
        refs: "emptyList()",
        report: `BoardTaskReport(now = "", results = "", next = "", revision = 0L, updatedAt = null, updatedBy = null)`,
        snapshots: "0L",
    },
};
const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);
const ident = (s: string) => "`" + s + "`";
/** A union's members with nested unions flattened (`Union([BoardAuthor, Literal("worker")])`). */
const members = (s: Schema): Schema[] => s.anyOf ? s.anyOf.flatMap(members) : [s];
const isString = (s: Schema) => s.type === "string";
const isObject = (s: Schema) => s.type === "object" && s.properties !== undefined;
/** The property every member fixes to its own string constant ("kind", "type"), if there is one. */
function discriminator(variants: Schema[]): string | undefined {
    if (variants.length < 2 || !variants.every(isObject)) return undefined;
    return Object.keys(variants[0]!.properties).find(p => {
        const values = variants.map(v => v.properties[p]?.const);
        return values.every(v => typeof v === "string" && (v as string).length > 0) && new Set(values).size === values.length && variants.every(v => v.required?.includes(p));
    });
}
const pascal = (s: string) => s.split(/[^A-Za-z0-9]+/).filter(Boolean).map(cap).join("");
function type(s: Schema, hint: string, self?: string): string {
    const named = names.get(key(s));
    if (named && named !== self) return named;
    if (s.anyOf) {
        const all = members(s);
        const nonNull = all.filter(x => x.type !== "null");
        const optional = nonNull.length !== all.length ? "?" : "";
        if (nonNull.length === 1) return type(nonNull[0]!, hint) + optional;
        if (nonNull.every(isString)) return "String" + optional;
        if (nonNull.every(x => x.type === "integer" || (x.type === "number" && Number.isInteger(x.const)))) return "Long" + optional;
        const by = discriminator(nonNull);
        if (by !== undefined) {
            // Unions told apart by a constant ("kind": "pull" | "issue" | "jira") become sealed interfaces; a variant
            // this build does not know decodes as Unknown<Name> with its JSON kept.
            const nonNullSchema = optional ? { anyOf: nonNull } : s;
            const name = unionNames.get(key(nonNullSchema)) ?? hint;
            unionNames.set(key(nonNullSchema), name);
            emitUnion(name, by, nonNull);
            return name + optional;
        }
        // Other heterogeneous JSON unions (input content, Chord tuples) stay lossless.
        return "JsonElement" + optional;
    }
    if (s.type === "string") return "String";
    if (s.type === "integer") return "Long";
    if (s.type === "number") return Number.isInteger(s.const) ? "Long" : "Double";
    if (s.type === "boolean") return "Boolean";
    if (s.type === "null") return "JsonNull";
    if (s.type === "array") return Array.isArray(s.items) ? "JsonArray" : `List<${type(s.items ?? {}, hint + "Item")}>`;
    if (s.type === "object") {
        if (!s.properties) return `Map<String, ${type(s.additionalProperties ?? Object.values(s.patternProperties ?? {})[0] ?? {}, hint + "Value")}>`;
        const name = self ?? hint;
        if (!self) names.set(key(s), name);
        emit(name, s);
        return name;
    }
    return "JsonElement";
}
function emit(name: string, s: Schema, union?: { name: string; by: string }) {
    if (output.has(name)) return;
    output.set(name, "");
    const required = new Set(s.required ?? []);
    const fields = Object.entries(s.properties as Record<string, Schema>).map(([p, v]) => {
        let t = type(v, name + cap(p));
        let fallback = "";
        if (v.const !== undefined) fallback = " = " + (typeof v.const === "number" ? v.const + (t === "Long" ? "L" : "") : JSON.stringify(v.const));
        else if (p === "id" && name.endsWith("Request")) fallback = " = java.util.UUID.randomUUID().toString()";
        else if (OLDER_BACKEND_DEFAULTS[name]?.[p] !== undefined) fallback = " = " + OLDER_BACKEND_DEFAULTS[name]![p];
        else if (!required.has(p)) { if (!t.endsWith("?")) t += "?"; fallback = " = null"; }
        return `    ${v.const !== undefined ? "@kotlinx.serialization.EncodeDefault " : ""}${p === union?.by ? "override " : ""}val ${ident(p)}: ${t}${fallback}`;
    });
    const supertype = union ? ` : ${union.name}` : name.endsWith("Event") ? " : ProtocolEvent" : "";
    // Relay registration carries capabilities/HMACs; generated DTOs must not leak them through diagnostics.
    const redacted = (["NotificationsRegisterRelayRequest", "NotificationsConfirmRelayRequest"].includes(name) || s.properties?.type?.const === "mcp.token.set")
        ? ` {\n    override fun toString(): String = "${name}(redacted)"\n}` : "";
    output.set(name, `@Serializable\ndata class ${name}(\n${fields.join(",\n")}\n)${supertype}${redacted}`);
}
function emitUnion(name: string, by: string, variants: Schema[]) {
    if (output.has(name)) return;
    output.set(name, "");
    const cases = variants.map(v => [v.properties[by].const as string, name + pascal(v.properties[by].const)] as const);
    for (const [i, v] of variants.entries()) emit(cases[i]![1], v, { name, by });
    output.set(name, `@Serializable(with = ${name}Serializer::class)
sealed interface ${name} { val ${ident(by)}: String }

/** A ${name} variant this build does not know, kept as it came. */
data class Unknown${name}(override val raw: JsonObject) : ${name}, UnknownVariant {
    override val ${ident(by)}: String get() = raw[${JSON.stringify(by)}]?.jsonPrimitive?.contentOrNull.orEmpty()
}

object ${name}Serializer : UnionSerializer<${name}>(${JSON.stringify(name)}, ${JSON.stringify(by)}, mapOf(
${cases.map(([value, variant]) => `    ${JSON.stringify(value)} to ${variant}.serializer(),`).join("\n")}
), { it.${ident(by)} }, ::Unknown${name})`);
}
// Named discriminated unions keep their protocol name (RefStatus, not RefsStatusResponseStatusesItem).
for (const [name, s] of Object.entries(defs)) if (s.anyOf && discriminator(members(s).filter(x => x.type !== "null")) !== undefined) unionNames.set(key(s), name);
for (const [name, s] of Object.entries(defs)) if (s.type === "object" && s.properties) emit(name, s);
const header = `// Generated by bun apps/android/scripts/generate-protocol.ts — do not edit.\n@file:OptIn(kotlinx.serialization.ExperimentalSerializationApi::class)\npackage io.github.mitzacoder.aiki.protocol\n\nimport kotlinx.serialization.KSerializer\nimport kotlinx.serialization.Serializable\nimport kotlinx.serialization.descriptors.SerialDescriptor\nimport kotlinx.serialization.encoding.Decoder\nimport kotlinx.serialization.encoding.Encoder\nimport kotlinx.serialization.json.*\n\n`;
const events = Object.entries(defs).filter(([name, s]) => name.endsWith("Event") && s.properties?.type?.const);
const models = header + `/** Same absent-hello-features fallback as packages/client. An explicit empty list stays empty. */
val DEFAULT_HARNESS_FEATURES: Set<String> = setOf(${LEGACY_HARNESS_FEATURES.map(feature => JSON.stringify(feature)).join(", ")})

/** The most refs one \`refs.status\` reads. */
const val MAX_REF_STATUS_REFS: Int = ${MAX_REF_STATUS_REFS}

/** The thread ID of a project's main conversation. */
const val MAIN_THREAD_ID: String = ${JSON.stringify(MAIN_THREAD_ID)}

/** What the harness puts before its notes about board changes in a coordinator's input. */
const val BOARD_PREFIX: String = ${JSON.stringify(BOARD_PREFIX)}

/** What the server puts before a message about a task: \`[task T12] \`. */
const val TASK_REFERENCE_PREFIX: String = ${JSON.stringify(TASK_REFERENCE_PREFIX)}

sealed interface ProtocolEvent

/** A union variant from a newer server, kept as raw JSON so nothing is lost when it is shown or sent back. */
interface UnknownVariant { val raw: JsonObject }

/** Decodes a discriminated union by its constant property; unknown values go to [unknown] instead of failing. */
open class UnionSerializer<T : Any>(
    name: String,
    private val discriminator: String,
    private val variants: Map<String, KSerializer<out T>>,
    private val tagOf: (T) -> String,
    private val unknown: (JsonObject) -> T,
) : KSerializer<T> {
    override val descriptor: SerialDescriptor = SerialDescriptor(name, JsonObject.serializer().descriptor)
    override fun deserialize(decoder: Decoder): T {
        val input = decoder as JsonDecoder
        val raw = input.decodeJsonElement().jsonObject
        val variant = variants[(raw[discriminator] as? JsonPrimitive)?.contentOrNull] ?: return unknown(raw)
        return input.json.decodeFromJsonElement(variant, raw)
    }
    override fun serialize(encoder: Encoder, value: T) {
        val output = encoder as JsonEncoder
        if (value is UnknownVariant) return output.encodeJsonElement(value.raw)
        @Suppress("UNCHECKED_CAST")
        val variant = variants.getValue(tagOf(value)) as KSerializer<T>
        output.encodeJsonElement(output.json.encodeToJsonElement(variant, value))
    }
}

` + [...output.values()].join("\n\n") + `

data class UnknownEvent(val raw: JsonObject) : ProtocolEvent

fun decodeProtocolEvent(raw: JsonObject, json: Json): ProtocolEvent = when(raw["type"]?.jsonPrimitive?.content) {
` + events.map(([name, s]) => `    ${JSON.stringify(s.properties.type.const)} -> json.decodeFromJsonElement(${name}.serializer(), raw)`).join("\n") + `
    else -> UnknownEvent(raw)
}
`;
const calls: string[] = [];
for (const [name] of Object.entries(defs)) {
    if (!name.endsWith("Request")) continue;
    const response = name.replace(/Request$/, "Response");
    if (output.has(response)) calls.push(`suspend fun HarnessClient.request(value: ${name}, explicitNulls: Set<String> = emptySet()): ${response} = exchange(\n    value.id, withExplicitNulls(wireJson.encodeToJsonElement(${name}.serializer(), value).jsonObject, explicitNulls), ${response}.serializer()\n)`);
}
const requests = `// Generated — do not edit.\npackage io.github.mitzacoder.aiki.data\n\nimport io.github.mitzacoder.aiki.protocol.*\nimport kotlinx.serialization.json.*\n\n` + calls.join("\n\n") + "\n";
const dir = new URL("../app/src/main/kotlin/io/github/mitzacoder/aiki/", import.meta.url);
for (const [p, contents] of [["protocol/Models.kt", models], ["data/Requests.kt", requests]]) {
    const path = new URL(p!, dir);
    if (process.argv.includes("--check")) {
        if (await Bun.file(path).text() !== contents) throw new Error(`${p} is stale`);
    } else await Bun.write(path, contents!);
}
console.log(`${output.size} typed DTOs; ${calls.length} typed request overloads`);

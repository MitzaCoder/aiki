package com.mihaisaru.harness.core

import kotlinx.serialization.json.*

/** Decoded Chord grammar, not JSON Patch. In particular t removes a UTF-16 PREFIX. */
fun applyChord(initial: JsonElement, operations: List<JsonArray>): JsonElement {
    var root = initial
    for (op in operations) {
        val verb = (op.firstOrNull() as? JsonPrimitive)?.content ?: error("Missing verb")
        val arity = when (verb) { "r", "d" -> 2; "s", "a", "t", "m" -> 3; "p" -> 5; else -> throw IllegalArgumentException("Unknown Chord verb: $verb") }
        require(op.size == arity) { "Wrong $verb arity" }
        if (verb == "r") { root = op[1]; continue }
        val path = op[1] as? JsonArray ?: throw IllegalArgumentException("Path must be an array")
        path.forEach {
            require(it is JsonPrimitive && (it.isString || it.intOrNull?.let { n -> n >= 0 } == true))
            require(!it.isString || it.content !in setOf("__proto__", "prototype", "constructor")) { "Unsafe path" }
        }
        if (verb == "p" || verb == "m") {
            root = updateAt(root, path) { current ->
                val array = current as? JsonArray ?: throw IllegalArgumentException("Array target required")
                if (verb == "p") {
                    val start = nonnegative(op[2]).coerceAtMost(array.size)
                    val remove = nonnegative(op[3]).coerceAtMost(array.size - start)
                    val items = op[4] as? JsonArray ?: throw IllegalArgumentException("Splice items required")
                    JsonArray(array.take(start) + items + array.drop(start + remove))
                } else {
                    val permutation = (op[2] as? JsonArray)?.map(::nonnegative) ?: throw IllegalArgumentException("Permutation required")
                    require(permutation.size == array.size && permutation.toSet() == array.indices.toSet()) { "Invalid permutation" }
                    JsonArray(permutation.map { array[it] })
                }
            }
        } else {
            require(path.isNotEmpty()) { "Field operation cannot target root" }
            root = updateAt(root, path.dropLast(1)) { parent ->
                val key = path.last().jsonPrimitive
                fun replacement(current: JsonElement?): JsonElement = when (verb) {
                    "s" -> op[2]
                    "a", "t" -> {
                        require(current is JsonPrimitive && current.isString) { "String target required" }
                        if (verb == "a") {
                            require(op[2] is JsonPrimitive && op[2].jsonPrimitive.isString)
                            JsonPrimitive(current.content + op[2].jsonPrimitive.content)
                        } else JsonPrimitive(current.content.drop(nonnegative(op[2]).coerceAtMost(current.content.length)))
                    }
                    else -> throw IllegalArgumentException("Invalid field operation")
                }
                when (parent) {
                    is JsonObject -> JsonObject(parent.toMutableMap().apply {
                        if (verb == "d") remove(key.content) else put(key.content, replacement(parent[key.content]))
                    })
                    is JsonArray -> {
                        require(!key.isString)
                        val index = nonnegative(key)
                        require(index <= parent.size && (verb == "s" || index < parent.size))
                        JsonArray(parent.toMutableList().apply {
                            if (verb == "d") removeAt(index)
                            else if (index == size) add(replacement(null))
                            else set(index, replacement(parent[index]))
                        })
                    }
                    else -> throw IllegalArgumentException("Container required")
                }
            }
        }
    }
    return root
}

private fun nonnegative(value: JsonElement): Int {
    val primitive = value as? JsonPrimitive
    val number = primitive?.takeUnless { it.isString }?.intOrNull
    require(number != null && number >= 0) { "Nonnegative integer required" }
    return number
}

private fun updateAt(root: JsonElement, path: List<JsonElement>, update: (JsonElement) -> JsonElement): JsonElement {
    if (path.isEmpty()) return update(root)
    val key = path.first().jsonPrimitive
    return when (root) {
        is JsonObject -> {
            val child = root[key.content] ?: throw IllegalArgumentException("Missing path")
            JsonObject(root + (key.content to updateAt(child, path.drop(1), update)))
        }
        is JsonArray -> {
            require(!key.isString)
            val index = nonnegative(key)
            require(index < root.size)
            JsonArray(root.toMutableList().apply { set(index, updateAt(root[index], path.drop(1), update)) })
        }
        else -> throw IllegalArgumentException("Invalid path")
    }
}

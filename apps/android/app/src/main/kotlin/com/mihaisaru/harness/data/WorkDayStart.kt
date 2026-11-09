package com.mihaisaru.harness.data

const val DEFAULT_WORK_DAY_START = "08:00"
fun normalizeWorkDayStart(start: String): String =
    start.takeIf { Regex("([01]\\d|2[0-3]):[0-5]\\d").matches(it) } ?: DEFAULT_WORK_DAY_START

package io.github.mitzacoder.aiki.tasks

import io.github.mitzacoder.aiki.features.tasks.questionCanAnswer
import io.github.mitzacoder.aiki.features.tasks.questionCanAnswerExpanded
import org.junit.Assert.*
import org.junit.Test

class QuestionAnswerFormTest {
    @Test fun onlyOpenEditableQuestionsCanBeAnswered() {
        val open = question("Q1", "T1")
        assertTrue(questionCanAnswer(open))
        assertTrue(questionCanAnswerExpanded(open))
        assertFalse(questionCanAnswer(open, readOnly = true))
        assertFalse(questionCanAnswerExpanded(open, readOnly = true))
        for (status in listOf("answered", "withdrawn")) {
            val resolved = open.copy(status = status)
            assertFalse(questionCanAnswer(resolved))
            assertFalse(questionCanAnswerExpanded(resolved))
        }
    }

    @Test fun warningsKeepOnlyTheirExistingInlineAcknowledgement() {
        val warning = question("Q2", "T1", kind = "warning")
        assertTrue(questionCanAnswer(warning))
        assertFalse(questionCanAnswerExpanded(warning))
        assertFalse(questionCanAnswer(warning, readOnly = true))
    }
}

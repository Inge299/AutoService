package ru.autoservice.spike

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Assume.assumeFalse
import org.junit.Rule
import org.junit.Test
import ru.autoservice.spike.data.FindingEntity
import ru.autoservice.spike.data.FindingPriority
import ru.autoservice.spike.data.FindingStatus
import ru.autoservice.spike.ui.FollowUpPlanDialog
import ru.autoservice.spike.ui.theme.AutoServiceTheme
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

class FollowUpPlanDialogTest {
    @get:Rule val compose = createComposeRule()
    private fun unlocked() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        assumeFalse(context.getSystemService(android.app.KeyguardManager::class.java).isKeyguardLocked)
    }
    private val finding = FindingEntity("qa-plan","qa-visit","Заменить ремень","Отложено клиентом",500,FindingPriority.PLANNED,FindingStatus.DEFERRED,1,1,serverVersion=1)
    @Test fun quickDateSavesAnIndividualDeadline() {
        unlocked();var saved:Long?=null;var state:String?=null
        compose.setContent { AutoServiceTheme { FollowUpPlanDialog(finding,null,{},{date,value,done->saved=date;state=value;done(null)}) } }
        compose.onNodeWithText("Месяц",useUnmergedTree=true).performScrollTo().performClick()
        compose.onNodeWithText("Сохранить срок").performScrollTo().performClick()
        assertEquals("OPEN",state)
        assertEquals(LocalDate.now(ZoneId.of("Europe/Moscow")).plusMonths(1),Instant.ofEpochMilli(requireNotNull(saved)).atZone(ZoneId.of("Europe/Moscow")).toLocalDate())
    }
    @Test fun completionIsSeparateFromOriginalFindingAndCancellationRequiresASecondChoice() {
        unlocked();val actions=mutableListOf<String>()
        compose.setContent { AutoServiceTheme { FollowUpPlanDialog(finding,null,{},{_,value,done->actions+=value;done(null)}) } }
        compose.onNodeWithText("Отметить выполненной").performScrollTo().performClick();assertEquals(listOf("DONE"),actions)
        compose.onNodeWithText("Снять с плана").performScrollTo().performClick();assertEquals(listOf("DONE"),actions)
        compose.onNodeWithText("Оставить").performClick();assertEquals(listOf("DONE"),actions)
    }
}

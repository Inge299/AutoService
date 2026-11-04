package ru.autoservice.spike

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.ImageFormat
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraDevice
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CaptureRequest
import android.media.ImageReader
import android.os.Handler
import android.os.HandlerThread
import androidx.core.content.ContextCompat
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

@RunWith(AndroidJUnit4::class)
class CameraHardwareTest {
    @Test fun cameraProducesJpeg() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        assumeTrue("Manual hardware test: grant CAMERA to the isolated package first", ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED)
        val manager = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
        val thread = HandlerThread("synthetic-camera-test").apply { start() }
        val handler = Handler(thread.looper)
        val reader = ImageReader.newInstance(640, 480, ImageFormat.JPEG, 2)
        val camera = AtomicReference<CameraDevice>()
        val session = AtomicReference<CameraCaptureSession>()
        val opened = CountDownLatch(1); val configured = CountDownLatch(1); val captured = CountDownLatch(1)
        val bytes = AtomicReference<ByteArray>()
        try {
            reader.setOnImageAvailableListener({ source ->
                source.acquireNextImage()?.use { image ->
                    val buffer = image.planes[0].buffer
                    bytes.set(ByteArray(buffer.remaining()).also { buffer.get(it) })
                    captured.countDown()
                }
            }, handler)
            manager.openCamera(manager.cameraIdList.first(), object : CameraDevice.StateCallback() {
                override fun onOpened(device: CameraDevice) { camera.set(device); opened.countDown() }
                override fun onDisconnected(device: CameraDevice) { device.close(); opened.countDown() }
                override fun onError(device: CameraDevice, error: Int) { device.close(); opened.countDown() }
            }, handler)
            assertTrue("camera did not open", opened.await(10, TimeUnit.SECONDS))
            val device = requireNotNull(camera.get())
            @Suppress("DEPRECATION")
            device.createCaptureSession(listOf(reader.surface), object : CameraCaptureSession.StateCallback() {
                override fun onConfigured(value: CameraCaptureSession) { session.set(value); configured.countDown() }
                override fun onConfigureFailed(value: CameraCaptureSession) { configured.countDown() }
            }, handler)
            assertTrue("camera session did not configure", configured.await(10, TimeUnit.SECONDS))
            val active = requireNotNull(session.get())
            val request = device.createCaptureRequest(CameraDevice.TEMPLATE_STILL_CAPTURE).apply { addTarget(reader.surface) }.build()
            active.capture(request, null, handler)
            assertTrue("camera did not return a photograph", captured.await(10, TimeUnit.SECONDS))
            val jpeg = bytes.get(); assertNotNull(jpeg)
            assertTrue(jpeg!!.size > 100 && jpeg[0] == 0xff.toByte() && jpeg[1] == 0xd8.toByte())
        } finally {
            session.get()?.close(); camera.get()?.close(); reader.close(); thread.quitSafely(); thread.join(2000)
        }
    }
}

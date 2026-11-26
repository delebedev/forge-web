package forge.web.browser.runtime;

public final class BrowserCallbacks {
    private BrowserCallbacks() {}

    public static native void awaitFailureDiagnostic();

    public static native void emit(String event, String data);
}

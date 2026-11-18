package br.com.hsi.myspot;

import android.hardware.GeomagneticField;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Declinação magnética (diferença entre o norte magnético e o norte verdadeiro)
 * pelo modelo geomagnético do próprio Android. A bússola da WebView aponta para
 * o norte magnético; o rumo até o carro é calculado em relação ao norte
 * verdadeiro. Em São Paulo a diferença passa de 20 graus.
 */
@CapacitorPlugin(name = "Declinacao")
public class DeclinacaoPlugin extends Plugin {

    @PluginMethod
    public void obter(PluginCall call) {
        Double lat = call.getDouble("lat");
        Double lng = call.getDouble("lng");
        if (lat == null || lng == null) {
            call.reject("lat e lng são obrigatórios");
            return;
        }
        GeomagneticField campo = new GeomagneticField(lat.floatValue(), lng.floatValue(), 0f, System.currentTimeMillis());
        JSObject ret = new JSObject();
        ret.put("graus", campo.getDeclination());
        call.resolve(ret);
    }
}

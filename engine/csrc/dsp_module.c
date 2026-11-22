#define PY_SSIZE_T_CLEAN
#include <Python.h>
#include <math.h>
#include <stdint.h>

static double decode_sample(const unsigned char *p, int width) {
    if (width == 1) return ((int)p[0] - 128) / 128.0;
    if (width == 2) {
        int32_t v = (int16_t)((uint16_t)p[0] | ((uint16_t)p[1] << 8));
        return v / 32768.0;
    }
    if (width == 3) {
        int32_t v = (int32_t)p[0] | ((int32_t)p[1] << 8) | ((int32_t)p[2] << 16);
        if (v & 0x800000) v |= (int32_t)0xff000000;
        return v / 8388608.0;
    }
    if (width == 4) {
        int32_t v = (int32_t)((uint32_t)p[0] | ((uint32_t)p[1] << 8) |
                              ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24));
        return v / 2147483648.0;
    }
    return 0.0;
}

static PyObject *analyze_pcm(PyObject *self, PyObject *args) {
    PyObject *data_obj;
    int sample_rate, channels, width;
    if (!PyArg_ParseTuple(args, "Oiii", &data_obj, &sample_rate, &channels, &width))
        return NULL;
    if (sample_rate < 1000 || channels < 1 || channels > 8 || width < 1 || width > 4) {
        PyErr_SetString(PyExc_ValueError, "音声形式の指定が不正です");
        return NULL;
    }
    Py_buffer view;
    if (PyObject_GetBuffer(data_obj, &view, PyBUF_CONTIG_RO) < 0) return NULL;
    Py_ssize_t frame_bytes = (Py_ssize_t)channels * width;
    Py_ssize_t frame_count = view.len / frame_bytes;
    if (frame_count < 2) {
        PyBuffer_Release(&view);
        PyErr_SetString(PyExc_ValueError, "音声データが短すぎます");
        return NULL;
    }

    Py_ssize_t stride = (frame_count + 8191) / 8192;
    Py_ssize_t count = (frame_count + stride - 1) / stride;
    double effective_rate = (double)sample_rate / (double)stride;
    double *samples = (double *)PyMem_Malloc((size_t)count * sizeof(double));
    if (!samples) {
        PyBuffer_Release(&view);
        return PyErr_NoMemory();
    }

    const unsigned char *raw = (const unsigned char *)view.buf;
    double peak = 0.0, sum_sq = 0.0;
    for (Py_ssize_t frame = 0; frame < frame_count; ++frame) {
        double mixed = 0.0;
        const unsigned char *base = raw + frame * frame_bytes;
        for (int ch = 0; ch < channels; ++ch)
            mixed += decode_sample(base + ch * width, width);
        mixed /= channels;
        double a = fabs(mixed);
        if (a > peak) peak = a;
        sum_sq += mixed * mixed;
    }

    Py_ssize_t out = 0;
    for (Py_ssize_t frame = 0; frame < frame_count; frame += stride) {
        double mixed = 0.0;
        const unsigned char *base = raw + frame * frame_bytes;
        for (int ch = 0; ch < channels; ++ch)
            mixed += decode_sample(base + ch * width, width);
        samples[out++] = mixed / channels;
    }
    PyBuffer_Release(&view);

    double rms = sqrt(sum_sq / (double)frame_count);
    long crossings = 0;
    for (Py_ssize_t i = 1; i < out; ++i)
        if ((samples[i - 1] < 0.0 && samples[i] >= 0.0) ||
            (samples[i - 1] >= 0.0 && samples[i] < 0.0)) crossings++;

    double best_corr = 0.0;
    int best_lag = 0;
    int min_lag = (int)(effective_rate / 1000.0);
    int max_lag = (int)(effective_rate / 60.0);
    if (min_lag < 1) min_lag = 1;
    if (max_lag > out / 2) max_lag = (int)(out / 2);
    if (rms > 0.002 && max_lag > min_lag) {
        for (int lag = min_lag; lag <= max_lag; ++lag) {
            double corr = 0.0, norm_a = 0.0, norm_b = 0.0;
            for (Py_ssize_t i = 0; i + lag < out; ++i) {
                double a = samples[i], b = samples[i + lag];
                corr += a * b;
                norm_a += a * a;
                norm_b += b * b;
            }
            double denom = sqrt(norm_a * norm_b);
            if (denom > 1e-12) {
                corr /= denom;
                if (corr > best_corr) {
                    best_corr = corr;
                    best_lag = lag;
                }
                /* Prefer the first strong period to avoid selecting a subharmonic. */
                if (corr >= 0.99) {
                    best_corr = corr;
                    best_lag = lag;
                    break;
                }
            }
        }
    }
    PyMem_Free(samples);
    double pitch = (best_lag > 0 && best_corr > 0.55) ? effective_rate / best_lag : 0.0;

    PyObject *result = PyDict_New();
    if (!result) return NULL;
    PyObject *v;
#define SET_NUM(key, value) do { v = PyFloat_FromDouble((double)(value)); if (!v || PyDict_SetItemString(result, key, v) < 0) { Py_XDECREF(v); Py_DECREF(result); return NULL; } Py_DECREF(v); } while (0)
    SET_NUM("peak", peak);
    SET_NUM("rms", rms);
    SET_NUM("zero_crossings_per_second", (double)crossings * effective_rate / (double)out);
    SET_NUM("pitch_hz", pitch);
    SET_NUM("pitch_confidence", best_corr);
    SET_NUM("analyzed_samples", out);
#undef SET_NUM
    return result;
}

static PyMethodDef methods[] = {
    {"analyze_pcm", analyze_pcm, METH_VARARGS, "Analyze interleaved integer PCM audio."},
    {NULL, NULL, 0, NULL}
};
static struct PyModuleDef module = {
    PyModuleDef_HEAD_INIT, "_dsp", "VoiceBankStudio native DSP module.", -1, methods
};
PyMODINIT_FUNC PyInit__dsp(void) { return PyModule_Create(&module); }

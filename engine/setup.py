from setuptools import Extension, find_packages, setup

setup(
    name="voicebankstudio-audio",
    version="0.1.0",
    description="Local audio analysis core for VoiceBankStudio",
    package_dir={"": "python"},
    packages=find_packages("python"),
    ext_modules=[Extension(
        "voicebankstudio_audio._dsp",
        sources=["csrc/dsp_module.c"],
        extra_compile_args=["-O2"],
    )],
    python_requires=">=3.10",
)

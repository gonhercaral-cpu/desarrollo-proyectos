import os
import sys
from pathlib import Path

import google.generativeai as genai
from google.api_core.exceptions import NotFound


# Las credenciales y los archivos de intercambio son exclusivamente locales.
orquestacion_dir = Path(__file__).resolve().parent / ".orquestacion"
input_file = orquestacion_dir / "tarea_para_gemini.md"
output_file = orquestacion_dir / "respuesta_de_gemini.md"
key_file = orquestacion_dir / "gemini_api_key.local"


def get_best_model(unavailable_models=None):
    unavailable_models = unavailable_models or set()
    for available_model in genai.list_models(request_options={"timeout": 30}):
        model_name = available_model.name.rsplit("/", 1)[-1].lower()
        if (
            model_name.startswith("gemini")
            and "pro" in model_name
            and "generateContent" in available_model.supported_generation_methods
            and available_model.name not in unavailable_models
        ):
            return available_model.name
    return "gemini-pro"


def main():
    # Evitar que una respuesta anterior parezca el resultado de una tarea fallida.
    output_file.write_text("", encoding="utf-8")
    if not input_file.exists():
        print(f"Error: No se encontró {input_file}", file=sys.stderr)
        return 1

    prompt = input_file.read_text(encoding="utf-8").strip()
    if not prompt:
        print("Error: La tarea para Gemini está vacía.", file=sys.stderr)
        return 1

    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key and key_file.exists():
        api_key = key_file.read_text(encoding="utf-8").strip()
    if not api_key:
        print("Error: Falta configurar GEMINI_API_KEY o la clave local.", file=sys.stderr)
        return 1

    try:
        genai.configure(api_key=api_key)
        unavailable_models = set()
        while True:
            model_name = get_best_model(unavailable_models)
            if model_name in unavailable_models:
                raise RuntimeError("No hay un modelo Gemini Pro disponible para esta cuenta.")
            print(f"Gemini usando el modelo: {model_name}...", flush=True)
            model = genai.GenerativeModel(model_name)
            try:
                response = model.generate_content(prompt, request_options={"timeout": 120})
                break
            except NotFound:
                unavailable_models.add(model_name)
                print(f"Modelo no disponible: {model_name}. Buscando otro Gemini Pro...", flush=True)
        result = response.text
        if not result or not result.strip():
            print("Error: Gemini no devolvió texto.", file=sys.stderr)
            return 1
        output_file.write_text(result, encoding="utf-8")
        print("Gemini terminó y guardó la respuesta.")
        return 0
    except Exception as error:
        # Conservar el diagnóstico sin imprimir la clave ni el texto de la tarea.
        error_message = str(error).replace(api_key, "[CLAVE OMITIDA]")
        error_message = error_message.replace(prompt, "[TAREA OMITIDA]")
        print(f"Error con Gemini ({type(error).__name__}): {error_message}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())

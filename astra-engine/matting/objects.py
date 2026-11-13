"""Mask of the main subject of a photo (a person, a building, a car, a pizza) for a paper collage.

IS-Net general use (DIS, Apache-2.0; the ONNX export of rembg). Input: raw RGB bytes of the photo resized to
1024x1024; output: raw 1024x1024 grey mask bytes. Pictures are read and written by the engine (sharp), so this
script needs only numpy and onnxruntime.

    python3 objects.py --model isnet-general-use.onnx --input photo.rgb --output mask.raw
"""
import argparse

import numpy as np
import onnxruntime as ort

SIZE = 1024


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    rgb = np.fromfile(args.input, dtype=np.uint8).reshape(SIZE, SIZE, 3).astype(np.float32)
    rgb = rgb / max(1.0, float(rgb.max()))
    rgb = rgb - np.array([0.485, 0.456, 0.406], dtype=np.float32)
    tensor = np.expand_dims(rgb.transpose(2, 0, 1), 0).astype(np.float32)

    options = ort.SessionOptions()
    options.intra_op_num_threads = 4
    session = ort.InferenceSession(args.model, options, providers=["CPUExecutionProvider"])
    pred = session.run(None, {session.get_inputs()[0].name: tensor})[0][0, 0]
    low, high = float(pred.min()), float(pred.max())
    mask = (pred - low) / max(1e-6, high - low)
    (mask * 255).clip(0, 255).astype(np.uint8).tofile(args.output)


if __name__ == "__main__":
    main()

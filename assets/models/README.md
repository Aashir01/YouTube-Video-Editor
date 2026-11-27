# Bundled models

| File | What it does | Source | License |
|---|---|---|---|
| `face_detection_yunet_2023mar.onnx` (232 KB) | Face detection for smart reframing (Shorts, "Track faces") | [YuNet](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet) from the OpenCV Model Zoo, by Shiqi Yu and contributors | MIT, see [LICENSE-yunet.txt](LICENSE-yunet.txt) |
| `selfie_segmentation_landscape.onnx`, `selfie_segmentation.onnx` (437 KB each) | Person segmentation for "Remove background" (the landscape model for wide footage, the square one otherwise) | [MediaPipe Selfie Segmentation](https://ai.google.dev/edge/mediapipe/solutions/vision/image_segmenter) by Google, converted from TFLite with [`scripts/convert-selfie-segmentation.py`](../../scripts/convert-selfie-segmentation.py) | Apache-2.0, see [LICENSE-mediapipe.txt](LICENSE-mediapipe.txt) |

The models run locally through `onnxruntime-node` (an optional dependency). Nothing is downloaded at run time.

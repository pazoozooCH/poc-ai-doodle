"""
Download Quick, Draw! data and train a CNN classifier.
Exports the model in TensorFlow.js format to ../public/model/

Usage:
    pip install tensorflow tensorflowjs numpy requests
    python train_model.py
"""

import os
import numpy as np
import requests
import tensorflow as tf
import tensorflowjs as tfjs

CATEGORIES = [
    'airplane', 'apple', 'banana', 'bicycle', 'bird', 'boat', 'car', 'cat',
    'clock', 'dog', 'fish', 'flower', 'guitar', 'hat', 'heart', 'house',
    'lightning', 'moon', 'pizza', 'shoe', 'smiley face', 'star', 'sun',
    'tree', 'umbrella'
]

DATA_DIR = 'data'
MODEL_DIR = os.path.join('..', 'public', 'model')
SAMPLES_PER_CATEGORY = 8000
BASE_URL = 'https://storage.googleapis.com/quickdraw_dataset/full/numpy_bitmap'


def download_data():
    os.makedirs(DATA_DIR, exist_ok=True)
    all_x, all_y = [], []

    for i, cat in enumerate(CATEGORIES):
        filename = f'{cat}.npy'
        filepath = os.path.join(DATA_DIR, filename)

        if not os.path.exists(filepath):
            url = f'{BASE_URL}/{requests.utils.quote(cat)}.npy'
            print(f'Downloading {cat}...')
            resp = requests.get(url)
            resp.raise_for_status()
            with open(filepath, 'wb') as f:
                f.write(resp.content)
        else:
            print(f'Using cached {cat}')

        data = np.load(filepath)
        # Take a subset and shuffle
        indices = np.random.permutation(len(data))[:SAMPLES_PER_CATEGORY]
        subset = data[indices]
        all_x.append(subset)
        all_y.append(np.full(len(subset), i))

    X = np.concatenate(all_x).reshape(-1, 28, 28, 1).astype('float32') / 255.0
    y = np.concatenate(all_y)

    # Shuffle
    perm = np.random.permutation(len(X))
    return X[perm], y[perm]


def build_model(num_classes):
    model = tf.keras.Sequential([
        tf.keras.layers.Conv2D(32, 3, activation='relu', input_shape=(28, 28, 1)),
        tf.keras.layers.MaxPooling2D(2),
        tf.keras.layers.Conv2D(64, 3, activation='relu'),
        tf.keras.layers.MaxPooling2D(2),
        tf.keras.layers.Conv2D(128, 3, activation='relu'),
        tf.keras.layers.Flatten(),
        tf.keras.layers.Dropout(0.3),
        tf.keras.layers.Dense(128, activation='relu'),
        tf.keras.layers.Dense(num_classes, activation='softmax')
    ])
    model.compile(
        optimizer='adam',
        loss='sparse_categorical_crossentropy',
        metrics=['accuracy']
    )
    return model


def main():
    print(f'Training model for {len(CATEGORIES)} categories')
    print(f'Categories: {", ".join(CATEGORIES)}\n')

    print('Step 1: Downloading data...')
    X, y = download_data()
    print(f'Dataset: {X.shape[0]} samples\n')

    split = int(len(X) * 0.9)
    X_train, X_val = X[:split], X[split:]
    y_train, y_val = y[:split], y[split:]

    print('Step 2: Training model...')
    model = build_model(len(CATEGORIES))
    model.summary()

    model.fit(
        X_train, y_train,
        validation_data=(X_val, y_val),
        epochs=8,
        batch_size=128,
        verbose=1
    )

    val_loss, val_acc = model.evaluate(X_val, y_val, verbose=0)
    print(f'\nValidation accuracy: {val_acc:.4f}')

    print(f'\nStep 3: Exporting to TensorFlow.js format -> {MODEL_DIR}')
    os.makedirs(MODEL_DIR, exist_ok=True)
    tfjs.converters.save_keras_model(model, MODEL_DIR)

    print('\nDone! Model saved. Start the server with: node server.js')


if __name__ == '__main__':
    main()

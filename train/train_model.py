"""
Download Quick, Draw! data and train a CNN classifier.
Exports the model in ONNX format to ../public/model/

Usage:
    cd train
    ../.venv/bin/python train_model.py
"""

import os
import numpy as np
import requests
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import TensorDataset, DataLoader

CATEGORIES = [
    'airplane', 'apple', 'banana', 'bicycle', 'bird', 'sailboat', 'car', 'cat',
    'clock', 'dog', 'fish', 'flower', 'guitar', 'hat', 'skull', 'house',
    'lightning', 'moon', 'pizza', 'shoe', 'smiley face', 'star', 'sun',
    'tree', 'umbrella'
]

DATA_DIR = 'data'
MODEL_DIR = os.path.join('..', 'public', 'model')
SAMPLES_PER_CATEGORY = 8000
BASE_URL = 'https://storage.googleapis.com/quickdraw_dataset/full/numpy_bitmap'


class DoodleCNN(nn.Module):
    def __init__(self, num_classes):
        super().__init__()
        self.features = nn.Sequential(
            nn.Conv2d(1, 32, 3), nn.ReLU(),
            nn.MaxPool2d(2),
            nn.Conv2d(32, 64, 3), nn.ReLU(),
            nn.MaxPool2d(2),
            nn.Conv2d(64, 128, 3), nn.ReLU(),
        )
        self.classifier = nn.Sequential(
            nn.Flatten(),
            nn.Dropout(0.3),
            nn.Linear(128 * 3 * 3, 128), nn.ReLU(),
            nn.Linear(128, num_classes),
        )

    def forward(self, x):
        x = self.features(x)
        x = self.classifier(x)
        return x


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
        indices = np.random.permutation(len(data))[:SAMPLES_PER_CATEGORY]
        subset = data[indices]
        all_x.append(subset)
        all_y.append(np.full(len(subset), i))

    X = np.concatenate(all_x).reshape(-1, 1, 28, 28).astype('float32') / 255.0
    y = np.concatenate(all_y).astype('int64')

    perm = np.random.permutation(len(X))
    return X[perm], y[perm]


def main():
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    print(f'Training on: {device}')
    print(f'Categories: {len(CATEGORIES)}\n')

    print('Step 1: Downloading data...')
    X, y = download_data()
    print(f'Dataset: {X.shape[0]} samples\n')

    split = int(len(X) * 0.9)
    train_ds = TensorDataset(torch.from_numpy(X[:split]), torch.from_numpy(y[:split]))
    val_ds = TensorDataset(torch.from_numpy(X[split:]), torch.from_numpy(y[split:]))
    train_dl = DataLoader(train_ds, batch_size=128, shuffle=True)
    val_dl = DataLoader(val_ds, batch_size=256)

    print('Step 2: Training model...')
    model = DoodleCNN(len(CATEGORIES)).to(device)
    optimizer = optim.Adam(model.parameters())
    criterion = nn.CrossEntropyLoss()

    for epoch in range(8):
        model.train()
        total_loss, correct, total = 0, 0, 0
        for xb, yb in train_dl:
            xb, yb = xb.to(device), yb.to(device)
            pred = model(xb)
            loss = criterion(pred, yb)
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()
            total_loss += loss.item() * len(xb)
            correct += (pred.argmax(1) == yb).sum().item()
            total += len(xb)

        model.eval()
        val_correct, val_total = 0, 0
        with torch.no_grad():
            for xb, yb in val_dl:
                xb, yb = xb.to(device), yb.to(device)
                pred = model(xb)
                val_correct += (pred.argmax(1) == yb).sum().item()
                val_total += len(xb)

        print(f'Epoch {epoch+1}/8 - loss: {total_loss/total:.4f} - '
              f'acc: {correct/total:.4f} - val_acc: {val_correct/val_total:.4f}')

    print(f'\nStep 3: Exporting to ONNX -> {MODEL_DIR}')
    os.makedirs(MODEL_DIR, exist_ok=True)
    model.eval()
    model.cpu()
    dummy = torch.randn(1, 1, 28, 28)
    torch.onnx.export(
        model, dummy,
        os.path.join(MODEL_DIR, 'model.onnx'),
        input_names=['input'],
        output_names=['output'],
        dynamic_axes={'input': {0: 'batch'}, 'output': {0: 'batch'}},
    )

    print('\nDone! Model saved. Start the server with: node server.js')


if __name__ == '__main__':
    main()

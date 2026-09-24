from PIL import Image, ImageOps
from tkinter import Tk, filedialog, messagebox
from pathlib import Path

GRID_SIZE = 3
CELL_SIZE = 1000
OUTPUT_SIZE = GRID_SIZE * CELL_SIZE
BACKGROUND = (0, 0, 0)
JPEG_QUALITY = 95

SUPPORTED = [
    ("Images", "*.jpg *.jpeg *.png *.webp *.bmp *.tif *.tiff"),
    ("All files", "*.*"),
]


def main():
    root = Tk()
    root.withdraw()
    root.attributes("-topmost", True)

    try:
        files = filedialog.askopenfilenames(
            parent=root,
            title="Select up to 9 pictures",
            filetypes=SUPPORTED,
        )

        if not files:
            return

        files = list(files)[:9]

        canvas = Image.new(
            "RGB",
            (OUTPUT_SIZE, OUTPUT_SIZE),
            BACKGROUND
        )

        for index, filename in enumerate(files):
            with Image.open(filename) as img:
                img = ImageOps.exif_transpose(img).convert("RGB")

                img = ImageOps.fit(
                    img,
                    (CELL_SIZE, CELL_SIZE),
                    method=Image.Resampling.LANCZOS,
                    centering=(0.5, 0.5),
                )

                column = index % GRID_SIZE
                row = index // GRID_SIZE

                x = column * CELL_SIZE
                y = row * CELL_SIZE

                canvas.paste(img, (x, y))

        first_file = Path(files[0])
        output_path = first_file.parent / "combined_3x3.jpg"

        counter = 2
        while output_path.exists():
            output_path = first_file.parent / f"combined_3x3_{counter}.jpg"
            counter += 1

        canvas.save(
            output_path,
            "JPEG",
            quality=JPEG_QUALITY,
            subsampling=0,
            optimize=True,
        )

        messagebox.showinfo(
            "Done",
            f"Saved:\n{output_path}",
            parent=root
        )

    except Exception as e:
        messagebox.showerror(
            "Error",
            str(e),
            parent=root
        )

    finally:
        root.destroy()


if __name__ == "__main__":
    main()
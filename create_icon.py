import os
from PIL import Image, ImageDraw, ImageFont

def create_icon(size, filename):
    img = Image.new('RGB', (size, size), color = (88, 166, 255))
    d = ImageDraw.Draw(img)
    # Simple icon: a circle with text
    d.ellipse([size*0.1, size*0.1, size*0.9, size*0.9], fill=(255, 255, 255))
    
    # Try to load a basic font, fallback to default
    try:
        font = ImageFont.truetype("arial.ttf", int(size*0.4))
    except:
        font = ImageFont.load_default()
        
    text = "WC"
    # Get text size using textbbox for newer PIL versions
    try:
        bbox = d.textbbox((0, 0), text, font=font)
        text_w = bbox[2] - bbox[0]
        text_h = bbox[3] - bbox[1]
    except AttributeError:
        text_w, text_h = d.textsize(text, font=font)
        
    d.text(((size-text_w)/2, (size-text_h)/2 - size*0.05), text, fill=(88, 166, 255), font=font)
    
    os.makedirs('img', exist_ok=True)
    img.save(os.path.join('img', filename))
    print(f"Generated {filename}")

if __name__ == '__main__':
    create_icon(192, 'app_icon_192.png')
    create_icon(512, 'app_icon_512.png')
    # Copy for manifest standard names if needed
    create_icon(192, 'app_icon.png')

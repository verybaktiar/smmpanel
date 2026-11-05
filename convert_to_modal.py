#!/usr/bin/env python3
"""
Script untuk mengonversi semua CRUD form inline menjadi modal
"""

def main():
    input_file = "public/index.html.backup"
    output_file = "public/index.html"
    
    with open(input_file, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Konversi section posting - Direct Post
    content = content.replace(
        '''      <div class="card">
        <div class="card-title">⚡ Post Sekarang (langsung)</div>
        <form id="postForm">''',
        '''      <div class="card">
        <div class="card-title">⚡ Post Sekarang (langsung)</div>
        <p class="muted" style="margin-bottom:14px;">Posting konten langsung ke akun yang dipilih</p>
        <button onclick="openPostModal()" class="green" style="width:100%;">➕ Buat Post Baru</button>
      </div>
      <div class="card" style="display:none;">
        <form id="postForm">'''
    )
    
    # Konversi section posting - Schedule
    content = content.replace(
        '''      <div class="card">
        <div class="card-title">🕒 Tambah Jadwal</div>
        <form id="schForm">''',
        '''      <div class="card">
        <div class="card-title">🕒 Jadwal Posting</div>
        <p class="muted" style="margin-bottom:14px;">Jadwalkan konten untuk diposting otomatis</p>
        <button onclick="openScheduleModal()" class="green" style="width:100%;">➕ Tambah Jadwal</button>
      </div>
      <div class="card" style="display:none;">
        <form id="schForm">'''
    )
    
    # Konversi section igpost - Instagram Post
    content = content.replace(
        '''      <div class="card">
        <div class="card-title">📤 Bagikan ke Instagram</div>
        <form id="igForm">''',
        '''      <div class="card">
        <div class="card-title">📤 Bagikan ke Instagram</div>
        <p class="muted" style="margin-bottom:14px;">Upload foto/video ke Instagram Feed</p>
        <button onclick="openIgPostModal()" class="green" style="width:100%;">➕ Buat Post Instagram</button>
      </div>
      <div class="card" style="display:none;">
        <form id="igForm">'''
    )
    
    # Konversi section likes - FB Like
    content = content.replace(
        '''      <div class="card">
        <div class="card-title">➕ Tambah Like Job</div>
        <form id="likeForm">''',
        '''      <div class="card">
        <div class="card-title">➕ Tambah Like Job</div>
        <p class="muted" style="margin-bottom:14px;">Auto-like postingan Facebook</p>
        <button onclick="openLikeModal()" class="green" style="width:100%;">➕ Tambah Like Job</button>
      </div>
      <div class="card" style="display:none;">
        <form id="likeForm">'''
    )
    
    # Konversi section smmlikes - SMM Order
    content = content.replace(
        '''      <div class="card">
        <div class="card-title">➕ Buat Order Like Baru</div>
        <form id="smmLikeForm">''',
        '''      <div class="card">
        <div class="card-title">➕ Buat Order Like Baru</div>
        <p class="muted" style="margin-bottom:14px;">Order like dengan rotasi akun otomatis</p>
        <button onclick="openSmmOrderModal()" class="green" style="width:100%;">➕ Buat Order Baru</button>
      </div>
      <div class="card" style="display:none;">
        <form id="smmLikeForm">'''
    )
    
    # Konversi section iglikes - IG Like
    content = content.replace(
        '''      <div class="card">
        <div class="card-title">➕ Tambah Like IG</div>
        <form id="igLikeForm">''',
        '''      <div class="card">
        <div class="card-title">➕ Tambah Like IG</div>
        <p class="muted" style="margin-bottom:14px;">Auto-like postingan Instagram</p>
        <button onclick="openIgLikeModal()" class="green" style="width:100%;">➕ Tambah Like IG</button>
      </div>
      <div class="card" style="display:none;">
        <form id="igLikeForm">'''
    )
    
    # Konversi section proxy - Proxy
    content = content.replace(
        '''      <div class="card">
        <div class="card-title">➕ Tambah Proxy</div>
        <form id="proxyForm">''',
        '''      <div class="card">
        <div class="card-title">➕ Tambah Proxy</div>
        <p class="muted" style="margin-bottom:14px;">Kelola proxy untuk akun</p>
        <button onclick="openProxyModal()" class="green" style="width:100%;">➕ Tambah Proxy</button>
      </div>
      <div class="card" style="display:none;">
        <form id="proxyForm">'''
    )
    
    # Tambahkan modal HTML sebelum closing </div> dari bulkImportModal (setelah line 671)
    modal_html = '''

<!-- ==================== CRUD MODALS ==================== -->

<!-- Modal Direct Post -->
<div class="modal-overlay" id="postModal">
  <div class="modal-form">
    <div class="modal-header">
      <h3>⚡ Post Sekarang</h3>
      <button class="modal-close" onclick="closePostModal()">×</button>
    </div>
    <form id="postFormModal">
      <label>Akun</label><select name="accountId" id="accSelectPostModal"><option>Muat akun...</option></select>
      <label>Generate AI (opsional)</label>
      <div style="display:flex; gap:8px; align-items:stretch;">
        <input name="aiPrompt" id="postAiPromptModal" placeholder="mis. buatkan berita trading yang menarik">
        <button type="button" class="ghost" style="white-space:nowrap; padding:10px 14px;" onclick="genAI('postAiPromptModal','postContentModal')">✨ Generate</button>
      </div>
      <label>Konten</label><textarea name="content" id="postContentModal" required placeholder="Konten akan terisi otomatis jika generate dipakai..."></textarea>
      <label>Gambar (opsional)</label><input name="media" type="file" accept="image/*">
      <div class="modal-btns" style="margin-top:10px;">
        <button type="button" class="ghost" onclick="closePostModal()">Batal</button>
        <button type="submit" class="green">🚀 Kirim Sekarang</button>
      </div>
    </form>
  </div>
</div>

<!-- Modal Schedule Post -->
<div class="modal-overlay" id="scheduleModal">
  <div class="modal-form">
    <div class="modal-header">
      <h3 id="scheduleModalTitle">🕒 Tambah Jadwal</h3>
      <button class="modal-close" onclick="closeScheduleModal()">×</button>
    </div>
    <form id="schFormModal">
      <input type="hidden" name="scheduleId" id="scheduleIdModal">
      <label>Akun</label><select name="accountId" id="accSelectModal"><option>Muat akun...</option></select>
      <label>Generate AI (opsional)</label>
      <div style="display:flex; gap:8px; align-items:stretch;">
        <input name="aiPrompt" id="schAiPromptModal" placeholder="mis. buatkan berita trading yang menarik">
        <button type="button" class="ghost" style="white-space:nowrap; padding:10px 14px;" onclick="genAI('schAiPromptModal','schContentModal')">✨ Generate</button>
      </div>
      <label>Konten</label><textarea name="content" id="schContentModal" required placeholder="Konten akan terisi otomatis jika generate dipakai..."></textarea>
      <label>Gambar (opsional)</label><input name="media" type="file" accept="image/*">
      <label>Ulangi</label>
      <select name="repeat" id="schRepeatModal">
        <option value="none">Sekali saja</option>
        <option value="daily">Harian</option>
        <option value="weekly">Mingguan</option>
        <option value="monthly">Bulanan</option>
      </select>
      <label>Waktu (jam lokal)</label><input name="time" type="time" required id="schTimeModal">
      <div class="modal-btns" style="margin-top:10px;">
        <button type="button" class="ghost" onclick="closeScheduleModal()">Batal</button>
        <button type="submit" class="green">💾 Simpan Jadwal</button>
      </div>
    </form>
  </div>
</div>

<!-- Modal Instagram Post -->
<div class="modal-overlay" id="igPostModal">
  <div class="modal-form">
    <div class="modal-header">
      <h3>📤 Bagikan ke Instagram</h3>
      <button class="modal-close" onclick="closeIgPostModal()">×</button>
    </div>
    <form id="igFormModal">
      <label>Akun</label><select name="accountId" id="igAccSelectModal"><option>Muat akun...</option></select>
      <label>Generate Caption AI (opsional)</label>
      <div style="display:flex; gap:8px; align-items:stretch;">
        <input name="aiPrompt" id="igAiPromptModal" placeholder="mis. caption promo produk menarik">
        <button type="button" class="ghost" style="white-space:nowrap; padding:10px 14px;" onclick="genAI('igAiPromptModal','igCaptionModal')">✨ Generate</button>
      </div>
      <label>Gambar / Video (wajib)</label><input name="media" type="file" accept="image/*,video/*" required>
      <label>Caption</label><textarea name="caption" id="igCaptionModal" placeholder="Tulis / generate caption postingan..."></textarea>
      <div class="modal-btns" style="margin-top:10px;">
        <button type="button" class="ghost" onclick="closeIgPostModal()">Batal</button>
        <button type="submit" class="green">📤 Bagikan ke Instagram</button>
      </div>
    </form>
  </div>
</div>

<!-- Modal FB Like -->
<div class="modal-overlay" id="likeModal">
  <div class="modal-form">
    <div class="modal-header">
      <h3 id="likeModalTitle">➕ Tambah Like Job</h3>
      <button class="modal-close" onclick="closeLikeModal()">×</button>
    </div>
    <form id="likeFormModal">
      <input type="hidden" name="likeId" id="likeIdModal">
      <label>Akun</label><select name="accountId" id="likeAccSelectModal"><option>Muat akun...</option></select>
      <label>Nama (label)</label><input name="name" required placeholder="Like postingan promo" id="likeNameModal">
      <label>URL Postingan</label><input name="postUrl" required placeholder="https://www.facebook.com/..." id="likeUrlModal">
      <div class="modal-btns" style="margin-top:10px;">
        <button type="button" class="ghost" onclick="closeLikeModal()">Batal</button>
        <button type="submit" class="green">💾 Simpan Like Job</button>
      </div>
    </form>
  </div>
</div>

<!-- Modal SMM Order -->
<div class="modal-overlay" id="smmOrderModal">
  <div class="modal-form">
    <div class="modal-header">
      <h3 id="smmOrderModalTitle">➕ Buat Order Like Baru</h3>
      <button class="modal-close" onclick="closeSmmOrderModal()">×</button>
    </div>
    <form id="smmLikeFormModal">
      <input type="hidden" name="orderId" id="smmOrderIdModal">
      <label>Platform</label>
      <select name="platform" onchange="updateSmmAccountInfoModal()" id="smmPlatformModal">
        <option value="fb">Facebook</option>
        <option value="ig">Instagram</option>
      </select>
      <label>Nama Order</label>
      <input name="name" required placeholder="Boost postingan promo" id="smmOrderNameModal">
      <label>URL Target Postingan</label>
      <input name="postUrl" required placeholder="https://www.facebook.com/..." style="font-size:13px;" id="smmOrderUrlModal">
      <label>Jumlah Like yang Diinginkan</label>
      <input name="targetCount" type="number" min="1" required placeholder="100" id="smmTargetCountModal">
      <div style="background:var(--card2); padding:12px; border-radius:8px; border:1px solid var(--border); margin-top:8px;">
        <div style="font-size:12px; color:var(--muted);" id="smmAccountInfoModal">Memuat info akun...</div>
      </div>
      <div class="modal-btns" style="margin-top:10px;">
        <button type="button" class="ghost" onclick="closeSmmOrderModal()">Batal</button>
        <button type="submit" class="green">🚀 Buat Order</button>
      </div>
    </form>
  </div>
</div>

<!-- Modal IG Like -->
<div class="modal-overlay" id="igLikeModal">
  <div class="modal-form">
    <div class="modal-header">
      <h3 id="igLikeModalTitle">➕ Tambah Like IG</h3>
      <button class="modal-close" onclick="closeIgLikeModal()">×</button>
    </div>
    <form id="igLikeFormModal">
      <input type="hidden" name="igLikeId" id="igLikeIdModal">
      <label>Akun (profile Facebook)</label><select name="accountId" id="igLikeAccSelectModal"><option>Muat akun...</option></select>
      <label>Nama (label)</label><input name="name" required placeholder="Like postingan IG" id="igLikeNameModal">
      <label>URL Postingan Instagram</label><input name="postUrl" required placeholder="https://www.instagram.com/p/..." id="igLikeUrlModal">
      <div class="modal-btns" style="margin-top:10px;">
        <button type="button" class="ghost" onclick="closeIgLikeModal()">Batal</button>
        <button type="submit" class="green">💾 Simpan Like IG</button>
      </div>
    </form>
  </div>
</div>

<!-- Modal Proxy -->
<div class="modal-overlay" id="proxyModal">
  <div class="modal-form">
    <div class="modal-header">
      <h3 id="proxyModalTitle">➕ Tambah Proxy</h3>
      <button class="modal-close" onclick="closeProxyModal()">×</button>
    </div>
    <form id="proxyFormModal">
      <input type="hidden" name="proxyId" id="proxyIdModal">
      <label>Proxy (format host:port:user:pass — bisa banyak, pisah baris)</label>
      <textarea name="values" required style="min-height:120px;" placeholder="31.59.20.176:6754:oqxpanjc:ybmjzac6okqe&#10;31.56.127.193:7684:oqxpanjc:ybmjzac6okqe" id="proxyValuesModal"></textarea>
      <div class="modal-btns" style="margin-top:10px;">
        <button type="button" class="ghost" onclick="closeProxyModal()">Batal</button>
        <button type="submit" class="green">💾 Simpan Proxy</button>
      </div>
    </form>
  </div>
</div>
'''
    
    # Insert modals sebelum closing tag bulk import modal
    content = content.replace('</div>\n</div>\n\n<script>', '</div>\n</div>' + modal_html + '\n\n<script>')
    
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write(content)
    
    print("Konversi selesai!")
    print(f"File output: {output_file}")

if __name__ == "__main__":
    main()

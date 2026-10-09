CREATE TABLE IF NOT EXISTS clinic_visits (
  id INT AUTO_INCREMENT PRIMARY KEY,
  patient_id INT NOT NULL,
  nurse_id INT NOT NULL,
  symptoms TEXT,
  vital_signs JSON,
  status ENUM('waiting', 'ready', 'completed') NOT NULL DEFAULT 'waiting',
  medical_record_id INT UNIQUE,
  dispensed_by INT,
  dispensed_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (patient_id) REFERENCES patients(id),
  FOREIGN KEY (nurse_id) REFERENCES users(id),
  FOREIGN KEY (medical_record_id) REFERENCES medical_records(id),
  FOREIGN KEY (dispensed_by) REFERENCES users(id),
  INDEX idx_visit_status (status, created_at)
);

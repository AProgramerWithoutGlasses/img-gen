package studio

import (
	"context"
	"database/sql"
	_ "golang.org/x/image/webp"
	_ "image/gif"
)

func migrateStudio(ctx context.Context, DB *sql.DB) error {
	for _, ddl := range []string{
		`CREATE TABLE IF NOT EXISTS studio_batches (id CHAR(32) PRIMARY KEY,user_id CHAR(32) NOT NULL,options JSON NOT NULL,fingerprint CHAR(64) NOT NULL,FOREIGN KEY(user_id) REFERENCES users(id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
		`CREATE TABLE IF NOT EXISTS studio_batch_jobs (batch_id CHAR(32) NOT NULL,job_id CHAR(32) NOT NULL UNIQUE,output_index INT NOT NULL,PRIMARY KEY(batch_id,output_index),FOREIGN KEY(batch_id) REFERENCES studio_batches(id),FOREIGN KEY(job_id) REFERENCES jobs(id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
		`CREATE TABLE IF NOT EXISTS studio_attachments (id CHAR(32) PRIMARY KEY,user_id CHAR(32) NOT NULL,name VARCHAR(255) NOT NULL,mime VARCHAR(32) NOT NULL,width INT NOT NULL,height INT NOT NULL,content LONGBLOB NOT NULL,created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),FOREIGN KEY(user_id) REFERENCES users(id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
		`CREATE TABLE IF NOT EXISTS studio_attachment_renditions (attachment_id CHAR(32) NOT NULL,kind VARCHAR(16) NOT NULL,version INT NOT NULL,mime VARCHAR(32) NOT NULL,etag CHAR(66) NOT NULL,byte_size INT NOT NULL,width INT NOT NULL,height INT NOT NULL,source_width INT NOT NULL,source_height INT NOT NULL,content MEDIUMBLOB NOT NULL,PRIMARY KEY(attachment_id,kind,version),FOREIGN KEY(attachment_id) REFERENCES studio_attachments(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
		`CREATE TABLE IF NOT EXISTS studio_batch_attachments (batch_id CHAR(32) NOT NULL,attachment_id CHAR(32) NOT NULL,position INT NOT NULL,PRIMARY KEY(batch_id,position),FOREIGN KEY(batch_id) REFERENCES studio_batches(id),FOREIGN KEY(attachment_id) REFERENCES studio_attachments(id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
		`CREATE TABLE IF NOT EXISTS studio_folders (id CHAR(32) PRIMARY KEY,user_id CHAR(32) NOT NULL,name VARCHAR(60) NOT NULL,created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),UNIQUE KEY idx_folder_name(user_id,name),FOREIGN KEY(user_id) REFERENCES users(id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
		`CREATE TABLE IF NOT EXISTS studio_image_folders (image_id CHAR(32) NOT NULL,folder_id CHAR(32) NOT NULL,PRIMARY KEY(image_id,folder_id),FOREIGN KEY(image_id) REFERENCES images(id),FOREIGN KEY(folder_id) REFERENCES studio_folders(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
	} {
		if _, err := DB.ExecContext(ctx, ddl); err != nil {
			return err
		}
	}
	return nil
}

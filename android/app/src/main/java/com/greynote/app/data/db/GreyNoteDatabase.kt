package com.greynote.app.data.db

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

@Database(entities = [NoteEntity::class], version = 1, exportSchema = false)
abstract class GreyNoteDatabase : RoomDatabase() {
    abstract fun noteDao(): NoteDao

    companion object {
        @Volatile
        private var instance: GreyNoteDatabase? = null

        fun get(context: Context): GreyNoteDatabase =
            instance ?: synchronized(this) {
                instance ?: Room.databaseBuilder(
                    context.applicationContext,
                    GreyNoteDatabase::class.java,
                    "greynote.db",
                ).fallbackToDestructiveMigration().build().also { instance = it }
            }

        /** Used when signing out: the cache belongs to the account that filled it. */
        fun reset(context: Context) {
            synchronized(this) {
                instance?.close()
                instance = null
                context.applicationContext.deleteDatabase("greynote.db")
            }
        }
    }
}
